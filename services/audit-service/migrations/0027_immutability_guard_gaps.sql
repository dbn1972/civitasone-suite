-- 0027_immutability_guard_gaps.sql
-- Closes two real gaps in the append-only / immutability story found during a
-- full audit-service deep-verification pass (2026-08-27), both confirmed live
-- against the shared dev DB before being written up here.
--
-- ============================================================================
-- PART 1 — events.events: the TRUNCATE guard (0011) never reached partitions
-- ============================================================================
-- Migration 0011_audit_truncate_guard.sql added trg_events_no_truncate
-- (BEFORE TRUNCATE ... FOR EACH STATEMENT) plus a REVOKE TRUNCATE, TRIGGER,
-- but only against `events.events` itself. That was correct at the time —
-- 0011 predates 0014_partition_audit_events.sql, which later converted
-- events.events into a partitioned table.
--
-- PostgreSQL clones ROW-level triggers from a partitioned parent onto every
-- partition automatically, which is why trg_events_immutable (BEFORE UPDATE
-- OR DELETE ... FOR EACH ROW, from 0006) already correctly covers every
-- partition today — confirmed via pg_trigger. STATEMENT-level triggers do
-- NOT get this automatic cloning, and 0014 never re-created
-- trg_events_no_truncate on the partitions it introduced. Live-verified
-- against the shared dev DB (in a transaction, rolled back, nothing was
-- actually destroyed):
--
--   BEGIN;
--   TRUNCATE events.events_y2026m08;   -- 15,332 rows in that partition
--   -- => "TRUNCATE TABLE" — succeeded. No exception. Guard did not fire.
--   ROLLBACK;
--
-- has_table_privilege('audit_svc','events.events_y2026m08','TRUNCATE') was
-- also true, confirming the REVOKE never reached the partition either. So
-- since 0014 ran, every individual monthly partition of the audit log
-- (where 100% of current rows physically live) has been truncatable in one
-- statement by anything holding audit_svc's credentials, with the
-- append-only guarantee only enforced against the (rarely-used-directly)
-- parent relation name.
--
-- Fix, in two parts:
--   (a) Retroactively attach the guard to every partition that exists today.
--       Uses pg_inherits (not a hardcoded partition-name list) so this is
--       correct regardless of exactly which months exist when it runs.
--   (b) Make it self-healing: events.create_future_partitions() (0014) is
--       invoked daily by worker.ts's partition-maintenance timer and monthly
--       by scripts/ops/create-future-partitions.sh, so patching the function
--       itself — rather than only today's partitions — means every partition
--       created from now on gets the guard automatically, with no dependency
--       on a human remembering to extend a migration again next month.
--
-- REVOKE note: events.events and its date-range partitions are currently
-- owned by civitas_admin on the shared dev DB (events_legacy is the one
-- exception, owned by audit_svc — it predates the 0014 partitioning and
-- already has its own copy of this guard). Because audit-service migrations
-- run as audit_svc (see scripts/ci/bootstrap-postgres.sh's SERVICE_DBS
-- loop — audit-service is NOT in the admin-owned-DB bucket), audit_svc is a
-- non-owner here, so REVOKE is empirically a real (if currently redundant —
-- see note below) defense-in-depth action, not a no-op. Live-verified:
--
--   REVOKE TRUNCATE ON events.events_y2026m08 FROM audit_svc;
--   -- => WARNING: no privileges could be revoked for "events_y2026m08"
--
-- i.e. it degrades to a harmless warning rather than failing the migration
-- (confirmed live), so it's kept for whenever the underlying grant shape
-- changes, but — exactly as 0006 already states for the parent table — the
-- BEFORE TRUNCATE trigger is the ONLY guard actually load-bearing here.
SET lock_timeout = '5s';

DO $$
DECLARE
  part_name text;
BEGIN
  FOR part_name IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = p.relnamespace
    WHERE n.nspname = 'events' AND p.relname = 'events'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = ('events.' || quote_ident(part_name))::regclass
        AND tgname = 'trg_events_no_truncate'
        AND NOT tgisinternal
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER trg_events_no_truncate BEFORE TRUNCATE ON events.%I FOR EACH STATEMENT EXECUTE FUNCTION events.reject_audit_truncate()',
        part_name
      );
    END IF;

    BEGIN
      EXECUTE format('REVOKE TRUNCATE, TRIGGER ON events.%I FROM audit_svc', part_name);
    EXCEPTION WHEN insufficient_privilege THEN
      -- Non-owner and no grant-option path to revoke via — expected in some
      -- environments (see note above). The trigger above is authoritative.
      RAISE NOTICE 'skipped REVOKE on events.% (insufficient privilege) — relying on trigger guard', part_name;
    END;
  END LOOP;
END $$;

-- Self-healing: every partition events.create_future_partitions() creates
-- from now on gets the same guard attached in the same statement that
-- creates it, so this gap cannot silently reopen next month. Function body
-- is otherwise byte-for-byte identical to 0014's definition.
--
-- Wrapped in EXECUTE + EXCEPTION rather than a bare top-level CREATE OR
-- REPLACE: on the shared dev DB this function is currently owned by
-- civitas_admin (drift — see note above on events.events' ownership), and
-- audit-service migrations run as audit_svc, so a bare statement here fails
-- the whole migration with "must be owner of function
-- create_future_partitions" (hit live while authoring this). On a fresh
-- container audit_svc owns everything 0014 created, so this succeeds there
-- outright. Where it can't apply itself, it says so instead of aborting —
-- see the accompanying PR description for the one-time manual
-- `CREATE OR REPLACE ... AS civitas_admin` also applied directly against the
-- shared dev DB, exactly as 0025/0026 (PR #775) were.
DO $outer$
BEGIN
  EXECUTE $ddl$
    CREATE OR REPLACE FUNCTION events.create_future_partitions()
    RETURNS void
    LANGUAGE plpgsql AS $inner$
    DECLARE
      start_date date;
      end_date   date;
      part_name  text;
      i          int;
    BEGIN
      FOR i IN 0..3 LOOP
        start_date := date_trunc('month', CURRENT_DATE) + (i || ' months')::interval;
        end_date   := start_date + '1 month'::interval;
        part_name  := 'events_y' || to_char(start_date, 'YYYY') || 'm' || to_char(start_date, 'MM');

        IF NOT EXISTS (
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'events' AND c.relname = part_name
        ) THEN
          EXECUTE format(
            'CREATE TABLE events.%I PARTITION OF events.events
             FOR VALUES FROM (%L) TO (%L)',
            part_name, start_date, end_date
          );
        END IF;

        -- G-FIX-1: attach the TRUNCATE guard to this partition unconditionally
        -- (idempotent — IF NOT EXISTS-guarded), whether it was just created
        -- above or already existed from a previous run that predates this fix.
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgrelid = ('events.' || quote_ident(part_name))::regclass
            AND tgname = 'trg_events_no_truncate'
            AND NOT tgisinternal
        ) THEN
          EXECUTE format(
            'CREATE TRIGGER trg_events_no_truncate BEFORE TRUNCATE ON events.%I FOR EACH STATEMENT EXECUTE FUNCTION events.reject_audit_truncate()',
            part_name
          );
        END IF;
        BEGIN
          EXECUTE format('REVOKE TRUNCATE, TRIGGER ON events.%I FROM audit_svc', part_name);
        EXCEPTION WHEN insufficient_privilege THEN
          NULL; -- trigger guard above is authoritative regardless
        END;
      END LOOP;
    END
    $inner$;
  $ddl$;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'skipped CREATE OR REPLACE FUNCTION events.create_future_partitions() — % is not its owner on this DB. Apply the replacement manually as the owning role (see this migration''s PART 1b for the full body) so future partitions keep self-healing the TRUNCATE guard.', current_user;
END $outer$;

-- ============================================================================
-- PART 2 — case-of-record tables: DELETE/TRUNCATE were never blocked at all
-- ============================================================================
-- events.events has had DB-level immutability since 0005/0006/0011. The
-- domain "case of record" tables that other audit-service modules own never
-- got the same treatment — they still carry whatever blanket grant the
-- original schema bootstrap gave audit_svc, which live-verified today
-- includes UPDATE, DELETE *and* TRUNCATE on every one of them:
--
--   observation.audit_observations, para.audit_paras,
--   para.audit_para_status_history, plan.audit_plans, risk.audit_risks,
--   risk.risk_acceptances, vigilance.vigilance_cases,
--   vigilance.vigilance_actions, vigilance.vigilance_evidence
--
-- UPDATE is correct and necessary here (these are live case-management
-- records — status transitions like open -> replied -> closed are the whole
-- point, and every write path already goes through optimistic-locked
-- `updateXxxVersioned()` calls plus a mirrored audit-event write). DELETE and
-- TRUNCATE are not used by any code path: grepping
-- services/audit-service/src for `.delete(` (Drizzle) and `app.delete(`
-- (Fastify routes) across every module returns zero matches. No feature
-- depends on being able to remove a row here, so blocking both outright is
-- pure hardening with no behavior change — directly closing the gap for
-- exactly the records called out as needing it: observations, paras, audit
-- plans, risk entries, and vigilance cases/actions/evidence (the last three
-- of which can carry confidential whistleblower-type material).
--
-- REVOKE is deliberately omitted here (unlike Part 1): every one of these
-- nine tables is owned directly by audit_svc itself (confirmed via
-- pg_get_userbyid), and audit-service's own runtime connects AS audit_svc.
-- A table owner's rights do not come from the ACL/GRANT list, so
-- `REVOKE ... FROM audit_svc` on a table audit_svc owns changes nothing and
-- would only give a false impression of a second layer of defense that
-- isn't really there. The trigger below is the ONLY enforcement for these
-- nine tables, and is unconditional regardless of role or ownership.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'observation' AND p.proname = 'reject_hard_delete') THEN
    CREATE FUNCTION observation.reject_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      RAISE EXCEPTION '% is a case-of-record table: % is not permitted (immutability policy)', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $f$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'para' AND p.proname = 'reject_hard_delete') THEN
    CREATE FUNCTION para.reject_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      RAISE EXCEPTION '% is a case-of-record table: % is not permitted (immutability policy)', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $f$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'plan' AND p.proname = 'reject_hard_delete') THEN
    CREATE FUNCTION plan.reject_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      RAISE EXCEPTION '% is a case-of-record table: % is not permitted (immutability policy)', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $f$;
  END IF;
  -- NOTE: unlike every other schema touched by this migration, `risk` is
  -- owned by civitas_admin, not audit_svc (has_schema_privilege confirms
  -- audit_svc lacks CREATE on it, even though it owns the individual tables
  -- inside — the one place in civitas_audit where the asymmetric-ownership
  -- pattern documented for court/inspection actually shows up here too).
  -- audit_svc DOES have CREATE on `public`, so the risk-table guard function
  -- lives there instead — a trigger on a `risk.*` table referencing a
  -- `public.*` function is ordinary cross-schema usage, not a workaround
  -- that weakens anything.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'audit_reject_hard_delete_risk') THEN
    CREATE FUNCTION public.audit_reject_hard_delete_risk() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      RAISE EXCEPTION '% is a case-of-record table: % is not permitted (immutability policy)', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $f$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'vigilance' AND p.proname = 'reject_hard_delete') THEN
    CREATE FUNCTION vigilance.reject_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN
      RAISE EXCEPTION '% is a case-of-record table (may hold confidential material): % is not permitted (immutability policy)', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $f$;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_no_hard_delete ON observation.audit_observations;
CREATE TRIGGER trg_no_hard_delete BEFORE DELETE OR TRUNCATE ON observation.audit_observations
  FOR EACH STATEMENT EXECUTE FUNCTION observation.reject_hard_delete();

DROP TRIGGER IF EXISTS trg_no_hard_delete ON para.audit_paras;
CREATE TRIGGER trg_no_hard_delete BEFORE DELETE OR TRUNCATE ON para.audit_paras
  FOR EACH STATEMENT EXECUTE FUNCTION para.reject_hard_delete();

DROP TRIGGER IF EXISTS trg_no_hard_delete ON para.audit_para_status_history;
CREATE TRIGGER trg_no_hard_delete BEFORE DELETE OR TRUNCATE ON para.audit_para_status_history
  FOR EACH STATEMENT EXECUTE FUNCTION para.reject_hard_delete();

DROP TRIGGER IF EXISTS trg_no_hard_delete ON plan.audit_plans;
CREATE TRIGGER trg_no_hard_delete BEFORE DELETE OR TRUNCATE ON plan.audit_plans
  FOR EACH STATEMENT EXECUTE FUNCTION plan.reject_hard_delete();

DROP TRIGGER IF EXISTS trg_no_hard_delete ON risk.audit_risks;
CREATE TRIGGER trg_no_hard_delete BEFORE DELETE OR TRUNCATE ON risk.audit_risks
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_reject_hard_delete_risk();

DROP TRIGGER IF EXISTS trg_no_hard_delete ON risk.risk_acceptances;
CREATE TRIGGER trg_no_hard_delete BEFORE DELETE OR TRUNCATE ON risk.risk_acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_reject_hard_delete_risk();

DROP TRIGGER IF EXISTS trg_no_hard_delete ON vigilance.vigilance_cases;
CREATE TRIGGER trg_no_hard_delete BEFORE DELETE OR TRUNCATE ON vigilance.vigilance_cases
  FOR EACH STATEMENT EXECUTE FUNCTION vigilance.reject_hard_delete();

DROP TRIGGER IF EXISTS trg_no_hard_delete ON vigilance.vigilance_actions;
CREATE TRIGGER trg_no_hard_delete BEFORE DELETE OR TRUNCATE ON vigilance.vigilance_actions
  FOR EACH STATEMENT EXECUTE FUNCTION vigilance.reject_hard_delete();

DROP TRIGGER IF EXISTS trg_no_hard_delete ON vigilance.vigilance_evidence;
CREATE TRIGGER trg_no_hard_delete BEFORE DELETE OR TRUNCATE ON vigilance.vigilance_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION vigilance.reject_hard_delete();

-- Rollback:
--   DROP TRIGGER trg_no_hard_delete ON observation.audit_observations; (repeat per table above)
--   DROP FUNCTION observation.reject_hard_delete(); (repeat per schema: para, plan, risk, vigilance)
--   DROP TRIGGER trg_events_no_truncate ON events.events_yYYYYmMM; (repeat per partition)
--   Restore events.create_future_partitions() to its 0014 definition.
-- Affected services: audit-service
