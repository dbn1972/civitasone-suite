-- 0038_future_partitions_owner_safe.sql
-- Purpose: make the daily audit partition job actually create (and correctly own / grant)
--          the monthly partitions of events.events and _outbox.messages, ahead of time.
--
-- Why (found 2026-11-12, read-only on the UAT DB):
--   * The worker (worker.ts ensurePartitions) runs events.create_future_partitions() as audit_svc.
--     On the UAT DB events.events, its partitions and the function itself are owned by civitas_admin
--     (0027 documents this drift), and the function was SECURITY INVOKER. So
--       CREATE TABLE ... PARTITION OF events.events  -> "must be owner of table events"
--     and REVOKE TRUNCATE, TRIGGER ... FROM audit_svc -> "no privileges could be revoked".
--   * Result: partitions exist only up to events_y2027m01 / messages_y2027m01. 2027-02 is never created
--     (the job fails every day), so from 1 Feb 2027 inserts would silently land in events_default /
--     messages_default and, once rows sit there, the 2027-02 partition can no longer be created at all.
--
-- Fix:
--   * events.ensure_monthly_partitions(...) does the work: SECURITY DEFINER (runs as the function owner,
--     which must be the owner of the parent table), pinned search_path, idempotent, takes the "as of"
--     date as a parameter so a month roll can be tested. It copies the parent's grants onto each new
--     partition, attaches the TRUNCATE guard (events only) and REVOKEs TRUNCATE, TRIGGER from audit_svc.
--     A month whose range already has rows in the DEFAULT partition is skipped with a WARNING instead of
--     aborting the whole run (the other months are still created).
--   * events.create_future_partitions() and _outbox.create_future_partitions() keep their zero-argument
--     signature (worker and scripts/ops callers unchanged) and now delegate: current month + 3 months ahead.
--   * events.missing_future_partitions() lets the worker verify the horizon and log an ERROR if it is short.
--   * One-time sweep: attach the guard / REVOKE on every existing events partition (0027 intended this).
--
-- Privilege note: migrations run as audit_svc. Where audit_svc does NOT own these objects (the UAT DB),
-- the statements that need ownership degrade to a NOTICE (same pattern as 0027) and the migration is
-- applied once as the table owner with scripts/ops/apply-audit-partition-fix.sh. Every statement is
-- idempotent, so applying it as audit_svc first and the owner afterwards (or the reverse) is safe; the
-- ownership-alignment block at the end makes the functions owned by the owner of events.events either way.
--
-- Rollback: restore the 0014 / 0015 / 0027 definitions of the two create_future_partitions() functions and
--   DROP FUNCTION IF EXISTS events.missing_future_partitions(date, int);
--   DROP FUNCTION IF EXISTS events.ensure_monthly_partitions(text, text, text, date, int, boolean);
-- (partitions already created are kept).

SET lock_timeout = '5s';

-- 1) Generic helper -------------------------------------------------------------------------------------
DO $mig$
BEGIN
  CREATE OR REPLACE FUNCTION events.ensure_monthly_partitions(
    p_schema          text,
    p_parent          text,
    p_prefix          text,
    p_as_of           date,
    p_months_ahead    int,
    p_truncate_guard  boolean
  ) RETURNS int
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $body$
  DECLARE
    v_parent     regclass := format('%I.%I', p_schema, p_parent)::regclass;
    v_first      date     := date_trunc('month', p_as_of)::date;
    v_start      date;
    v_part       text;
    v_created    int := 0;
    r            record;
  BEGIN
    IF p_months_ahead < 0 OR p_months_ahead > 24 THEN
      RAISE EXCEPTION 'months ahead out of range: %', p_months_ahead;
    END IF;

    FOR i IN 0..p_months_ahead LOOP
      v_start := (v_first + make_interval(months => i))::date;
      v_part  := p_prefix || '_y' || to_char(v_start, 'YYYY') || 'm' || to_char(v_start, 'MM');

      IF to_regclass(format('%I.%I', p_schema, v_part)) IS NULL THEN
        BEGIN
          EXECUTE format(
            'CREATE TABLE %I.%I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
            p_schema, v_part, v_parent,
            (v_start::timestamp AT TIME ZONE 'UTC'),
            ((v_start + interval '1 month')::timestamp AT TIME ZONE 'UTC'));
          v_created := v_created + 1;

          -- A partition created with PARTITION OF does not inherit the parent's ACL: copy it.
          FOR r IN
            SELECT pg_get_userbyid(a.grantee) AS grantee, string_agg(a.privilege_type, ', ') AS privs
              FROM pg_class c, aclexplode(c.relacl) a
             WHERE c.oid = v_parent AND a.grantee <> c.relowner AND a.grantee <> 0
             GROUP BY a.grantee
          LOOP
            EXECUTE format('GRANT %s ON %I.%I TO %I', r.privs, p_schema, v_part, r.grantee);
          END LOOP;
        EXCEPTION WHEN check_violation THEN
          -- Rows for this month are already in the DEFAULT partition; Postgres refuses to carve the
          -- partition out from under them. Do not abort the other months; surface it loudly.
          RAISE WARNING 'partition %.% not created: rows for % already sit in the default partition (move them, then re-run)',
            p_schema, v_part, to_char(v_start, 'YYYY-MM');
          CONTINUE;
        END;
      END IF;

      IF p_truncate_guard THEN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
           WHERE tgrelid = to_regclass(format('%I.%I', p_schema, v_part))
             AND tgname = 'trg_events_no_truncate' AND NOT tgisinternal
        ) THEN
          EXECUTE format(
            'CREATE TRIGGER trg_events_no_truncate BEFORE TRUNCATE ON %I.%I FOR EACH STATEMENT EXECUTE FUNCTION events.reject_audit_truncate()',
            p_schema, v_part);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_svc') THEN
          EXECUTE format('REVOKE TRUNCATE, TRIGGER ON %I.%I FROM audit_svc', p_schema, v_part);
        END IF;
      END IF;
    END LOOP;

    RETURN v_created;
  END
  $body$;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'skipped events.ensure_monthly_partitions — % cannot create it here; apply as the table owner via scripts/ops/apply-audit-partition-fix.sh', current_user;
END $mig$;

-- The helper takes an arbitrary date: not callable by application roles.
DO $mig$
BEGIN
  REVOKE ALL ON FUNCTION events.ensure_monthly_partitions(text, text, text, date, int, boolean) FROM PUBLIC;
  -- audit_svc loses it too, unless audit_svc IS the owner (fresh/CI bootstrap): revoking an owner's own
  -- EXECUTE would stop the SECURITY DEFINER wrappers from calling it.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_svc')
     AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'events.ensure_monthly_partitions(text, text, text, date, int, boolean)'::regprocedure
                      AND pg_get_userbyid(proowner) = 'audit_svc') THEN
    REVOKE ALL ON FUNCTION events.ensure_monthly_partitions(text, text, text, date, int, boolean) FROM audit_svc;
  END IF;
EXCEPTION WHEN insufficient_privilege OR undefined_function THEN
  RAISE NOTICE 'skipped helper REVOKE (not owner / helper absent)';
END $mig$;

-- 2) Zero-argument wrappers (signatures unchanged) -----------------------------------------------------
DO $mig$
BEGIN
  CREATE OR REPLACE FUNCTION events.create_future_partitions()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $body$
  BEGIN
    PERFORM events.ensure_monthly_partitions('events', 'events', 'events',
                                             (now() AT TIME ZONE 'UTC')::date, 3, true);
  END
  $body$;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'skipped CREATE OR REPLACE FUNCTION events.create_future_partitions() — % is not its owner; apply via scripts/ops/apply-audit-partition-fix.sh', current_user;
END $mig$;

DO $mig$
BEGIN
  CREATE OR REPLACE FUNCTION _outbox.create_future_partitions()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $body$
  BEGIN
    PERFORM events.ensure_monthly_partitions('_outbox', 'messages', 'messages',
                                             (now() AT TIME ZONE 'UTC')::date, 3, false);
  END
  $body$;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'skipped CREATE OR REPLACE FUNCTION _outbox.create_future_partitions() — % is not its owner; apply via scripts/ops/apply-audit-partition-fix.sh', current_user;
END $mig$;

-- The wrappers run as their owner (SECURITY DEFINER): only the application role may call them, not PUBLIC.
DO $mig$
BEGIN
  REVOKE ALL ON FUNCTION events.create_future_partitions() FROM PUBLIC;
  REVOKE ALL ON FUNCTION _outbox.create_future_partitions() FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_svc') THEN
    GRANT EXECUTE ON FUNCTION events.create_future_partitions() TO audit_svc;
    GRANT EXECUTE ON FUNCTION _outbox.create_future_partitions() TO audit_svc;
  END IF;
EXCEPTION WHEN insufficient_privilege OR undefined_function THEN
  RAISE NOTICE 'skipped wrapper EXECUTE hardening (not owner / wrapper absent) — apply via scripts/ops/apply-audit-partition-fix.sh as the table owner';
END $mig$;

-- 3) Horizon check used by the worker: how many of the next p_months_ahead+1 months have no partition.
DO $mig$
BEGIN
  CREATE OR REPLACE FUNCTION events.missing_future_partitions(
    p_as_of        date DEFAULT (now() AT TIME ZONE 'UTC')::date,
    p_months_ahead int  DEFAULT 3
  ) RETURNS int
  LANGUAGE sql STABLE
  AS $body$
    SELECT count(*)::int
      FROM generate_series(0, p_months_ahead) AS i
     WHERE to_regclass(format('events.%I',
             to_char(date_trunc('month', p_as_of) + make_interval(months => i), '"events_y"YYYY"m"MM'))) IS NULL
        OR to_regclass(format('_outbox.%I',
             to_char(date_trunc('month', p_as_of) + make_interval(months => i), '"messages_y"YYYY"m"MM'))) IS NULL
  $body$;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'skipped events.missing_future_partitions — % cannot create it here', current_user;
END $mig$;

-- 4) One-time sweep: every existing events partition gets the TRUNCATE guard and loses audit_svc's
--    TRUNCATE/TRIGGER (0027 intended this; on the UAT DB it never took effect). Needs ownership.
DO $mig$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS rel
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = 'events.events'::regclass
  LOOP
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = r.rel AND tgname = 'trg_events_no_truncate' AND NOT tgisinternal) THEN
        EXECUTE format('CREATE TRIGGER trg_events_no_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION events.reject_audit_truncate()', r.rel);
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_svc') THEN
        EXECUTE format('REVOKE TRUNCATE, TRIGGER ON %s FROM audit_svc', r.rel);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'skipped guard sweep on % (not owner)', r.rel;
    END;
  END LOOP;
END $mig$;

-- 5) Ownership alignment: SECURITY DEFINER only helps if the functions are owned by the owner of the
--    parent tables. If we ran as a superuser/owner and the function was first created by audit_svc, fix it.
DO $mig$
DECLARE
  v_owner name;
  f text;
BEGIN
  SELECT pg_get_userbyid(relowner) INTO v_owner FROM pg_class WHERE oid = 'events.events'::regclass;
  FOREACH f IN ARRAY ARRAY[
    'events.ensure_monthly_partitions(text, text, text, date, int, boolean)',
    'events.create_future_partitions()',
    '_outbox.create_future_partitions()'
  ] LOOP
    BEGIN
      IF to_regprocedure(f) IS NOT NULL
         AND (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = to_regprocedure(f)) <> v_owner THEN
        EXECUTE format('ALTER FUNCTION %s OWNER TO %I', f, v_owner);
      END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'skipped ownership alignment of % (run scripts/ops/apply-audit-partition-fix.sh as the table owner)', f;
    END;
  END LOOP;
END $mig$;

-- 6) Create the partitions now (no-op where the wrappers could not be replaced).
DO $mig$
BEGIN
  PERFORM events.create_future_partitions();
  PERFORM _outbox.create_future_partitions();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'partition creation deferred to the worker: %', SQLERRM;
END $mig$;
