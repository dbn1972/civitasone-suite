-- 0027_immutability_guard_gaps.sql
-- Closes two real gaps in the append-only / immutability story found during a
-- full audit-service deep-verification pass (2026-08-27), both confirmed live
-- against the shared dev DB before being written up here, and revised after
-- an independent code review caught a portability bug (see PART 2 note).
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
-- Privilege note: events.events and its date-range partitions are currently
-- owned by civitas_admin on the shared dev DB (events_legacy is the one
-- exception, owned by audit_svc — it predates the 0014 partitioning and
-- already has its own copy of this guard). Because audit-service migrations
-- run as audit_svc (see scripts/ci/bootstrap-postgres.sh's SERVICE_DBS loop —
-- audit-service is NOT in the admin-owned-DB bucket), audit_svc is a
-- non-owner here. Both CREATE TRIGGER and REVOKE are wrapped in
-- EXCEPTION WHEN insufficient_privilege for that reason: CREATE TRIGGER only
-- needs the TRIGGER privilege (which audit_svc already holds — confirmed
-- live, so the wrap is a no-cost safety net, not a known-necessary path
-- today) while REVOKE needs ownership or a grant-option path audit_svc does
-- not have (confirmed live: it degrades to
-- "WARNING: no privileges could be revoked", which does not abort the
-- migration on its own — the EXCEPTION handler is extra insurance for
-- environments where REVOKE's failure mode is a hard error instead of a
-- warning). Either way — exactly as 0006 already states for the parent
-- table — the BEFORE TRUNCATE trigger is the guard that actually matters;
-- REVOKE is defense-in-depth on top of it, never the only line of defense.
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
      BEGIN
        EXECUTE format(
          'CREATE TRIGGER trg_events_no_truncate BEFORE TRUNCATE ON events.%I FOR EACH STATEMENT EXECUTE FUNCTION events.reject_audit_truncate()',
          part_name
        );
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'could not create trg_events_no_truncate on events.% (insufficient privilege) — this partition is NOT protected against direct TRUNCATE; apply manually as the table owner', part_name;
      END;
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
-- Plain CREATE OR REPLACE FUNCTION directly inside the DO block's BEGIN —
-- PL/pgSQL runs DDL commands like this one directly, no EXECUTE indirection
-- needed (confirmed empirically: a bare CREATE OR REPLACE FUNCTION inside a
-- DO $$ ... $$ body executes with no error). On the shared dev DB this
-- function is currently owned by civitas_admin (drift — see note above on
-- events.events' ownership), and audit-service migrations run as audit_svc,
-- so this fails with "must be owner of function create_future_partitions"
-- there (hit live while authoring this) — caught below and downgraded to a
-- NOTICE rather than aborting the whole migration. On a fresh container
-- audit_svc owns everything 0014 created, so this succeeds outright there.
-- The replacement was additionally applied by hand as civitas_admin directly
-- against the shared dev DB (same approach PR #775 used for its data fix),
-- so the live daily partition-maintenance job is self-healing starting now.
DO $$
BEGIN
  CREATE OR REPLACE FUNCTION events.create_future_partitions()
  RETURNS void
  LANGUAGE plpgsql AS $body$
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
  $body$;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'skipped CREATE OR REPLACE FUNCTION events.create_future_partitions() — % is not its owner on this DB; applied manually as civitas_admin instead (see PR description) so the live daily partition job still self-heals', current_user;
END $$;

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
-- updateXxxVersioned() calls plus a mirrored audit-event write). DELETE and
-- TRUNCATE are not used by any code path: a full grep of
-- services/audit-service/src for ORM-level delete calls and Fastify DELETE
-- routes across every module returns zero matches. No feature depends on
-- being able to remove a row here, so blocking both outright is pure
-- hardening with no behavior change — directly closing the gap for exactly
-- the records called out as needing it: observations, paras, audit plans,
-- risk entries, and vigilance cases/actions/evidence (the last three of
-- which can carry confidential whistleblower-type material).
--
-- REVOKE is deliberately omitted here (unlike Part 1): every one of these
-- nine tables is owned directly by audit_svc itself (confirmed via
-- pg_get_userbyid), and audit-service's own runtime connects AS audit_svc.
-- A table owner's rights do not come from the ACL/GRANT list, so
-- `REVOKE ... FROM audit_svc` on a table audit_svc owns changes nothing and
-- would only give a false impression of a second layer of defense that
-- isn't really there. The trigger below is the ONLY enforcement for these
-- nine tables, and is unconditional regardless of role or ownership.
--
-- Schema-privilege note (found by independent review of the first version of
-- this migration, before it merged): `risk` is the one schema in this file
-- where CREATE is NOT reliably available to audit_svc. On the shared dev DB
-- it happened to also work via `public` — but infra/db/bootstrap/
-- bootstrap.generated.sql explicitly runs `REVOKE ALL ON SCHEMA public FROM
-- PUBLIC;` for civitas_audit with no subsequent GRANT of CREATE on public
-- back to audit_svc, so `public` is not actually safe either: a fresh/CI
-- bootstrap would hit "permission denied for schema public" instead. Fixed
-- by putting the two risk-table guard functions in `events` instead — the
-- one schema in this migration that is guaranteed audit_svc-owned in every
-- environment (it is audit-service's own foundational schema, and already
-- hosts reject_audit_truncate()/reject_audit_mutation(), the same kind of
-- guard function) — rather than a schema whose availability turned out to
-- depend on environment-specific drift.
-- Cleanup: an earlier draft of this migration (superseded before merge, see
-- PR review) briefly created this function on the shared dev DB before the
-- schema-privilege issue above was caught. Drop it so it doesn't linger as
-- unreferenced cruft; CASCADE is safe here since nothing should still
-- reference it after the trigger recreations below repoint to
-- events.reject_hard_delete_risk().
DROP FUNCTION IF EXISTS public.audit_reject_hard_delete_risk() CASCADE;

CREATE OR REPLACE FUNCTION observation.reject_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is a case-of-record table: % is not permitted (immutability policy)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE OR REPLACE FUNCTION para.reject_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is a case-of-record table: % is not permitted (immutability policy)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE OR REPLACE FUNCTION plan.reject_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is a case-of-record table: % is not permitted (immutability policy)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- Lives in `events`, not `risk` — see schema-privilege note above.
CREATE OR REPLACE FUNCTION events.reject_hard_delete_risk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is a case-of-record table: % is not permitted (immutability policy)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE OR REPLACE FUNCTION vigilance.reject_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is a case-of-record table (may hold confidential material): % is not permitted (immutability policy)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

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
  FOR EACH STATEMENT EXECUTE FUNCTION events.reject_hard_delete_risk();

DROP TRIGGER IF EXISTS trg_no_hard_delete ON risk.risk_acceptances;
CREATE TRIGGER trg_no_hard_delete BEFORE DELETE OR TRUNCATE ON risk.risk_acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION events.reject_hard_delete_risk();

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
--   DROP FUNCTION observation.reject_hard_delete(); para.reject_hard_delete();
--     plan.reject_hard_delete(); events.reject_hard_delete_risk();
--     vigilance.reject_hard_delete();
--   DROP TRIGGER trg_events_no_truncate ON events.events_yYYYYmMM; (repeat per partition)
--   Restore events.create_future_partitions() to its 0014 definition.
-- Affected services: audit-service
