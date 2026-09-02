-- 0029_events_immutability_trigger_missing_on_partitions.sql
-- SECURITY / CERT-In tamper-evidence: trg_events_immutable never reached the
-- partitioned events.events table introduced by 0014.
--
-- ============================================================================
-- Root cause
-- ============================================================================
-- 0005/0006_audit_immutability.sql created trg_events_immutable (BEFORE
-- UPDATE OR DELETE ... FOR EACH ROW, calling events.reject_audit_mutation())
-- directly on the original, non-partitioned events.events relation. That was
-- correct at the time.
--
-- 0014_partition_audit_events.sql later converted events.events to
-- declarative RANGE partitioning by (a) renaming the ORIGINAL relation to
-- events_legacy — which keeps its triggers, since ALTER TABLE ... RENAME does
-- not touch trigger definitions — and (b) creating a BRAND NEW relation via
-- `CREATE TABLE events.events (...) PARTITION BY RANGE (created_at)`. A fresh
-- CREATE TABLE starts with zero triggers. 0014 never re-created
-- trg_events_immutable (or its function) on this new parent, so from the
-- moment 0014 ran, the live, partitioned events.events — where 100% of
-- current audit rows physically live — has had NO immutability guard at all.
-- events_legacy still has the trigger, but it is not what the application
-- writes to any more.
--
-- ============================================================================
-- Correcting a false claim in 0027_immutability_guard_gaps.sql
-- ============================================================================
-- 0027's PART 1 comment states: "PostgreSQL clones ROW-level triggers from a
-- partitioned parent onto every partition automatically, which is why
-- trg_events_immutable (BEFORE UPDATE OR DELETE ... FOR EACH ROW, from 0006)
-- already correctly covers every partition today — confirmed via pg_trigger."
--
-- The general PostgreSQL behavior described (row-level triggers created ON
-- THE PARENT do auto-clone to partitions, unlike statement-level triggers
-- such as trg_events_no_truncate, which is the real bug 0027 fixes) is
-- correct. But the conclusion drawn from it for trg_events_immutable is NOT:
-- auto-cloning only applies to a trigger that actually exists ON THE PARENT.
-- As established above, trg_events_immutable was never created on the
-- post-0014 events.events parent at all — the "already covers every
-- partition" pg_trigger check 0027 describes must have been run against
-- events_legacy (which does have the trigger, inherited from before the
-- rename) rather than the new partitioned events.events, or against a
-- session that mis-resolved which relation "events.events" pointed at.
--
-- Independently re-verified live (2026-09-02) against events.events on the
-- current partitioned table:
--   INSERT INTO events.events (...) VALUES (...);            -- succeeds
--   UPDATE events.events SET severity = 'critical' WHERE ...; -- SUCCEEDS,
--                                                                 no exception
--   DELETE FROM events.events WHERE ...;                      -- SUCCEEDS,
--                                                                 row gone
-- Every audit event inserted since 0014 ran has been mutable and deletable
-- by anything holding audit_svc's credentials (or higher). This migration is
-- the actual fix; 0027's file is left unmodified per policy (never edit a
-- past migration) — this comment is the correction for future readers.
--
-- ============================================================================
-- Fix
-- ============================================================================
-- 1) Create trg_events_immutable on the current events.events PARENT. Because
--    it is FOR EACH ROW, PostgreSQL clones it onto every partition that
--    exists at creation time automatically (empirically confirmed below in
--    this migration's verification loop, and in the PR's test evidence) —
--    no explicit per-partition CREATE TRIGGER is needed or possible: once the
--    parent owns a row-level trigger of this name, attempting to create one
--    explicitly on a partition raises "trigger ... already exists", which is
--    exactly the IF NOT EXISTS-guarded verification loop below relies on.
--    This is the opposite situation from 0027 Part 1's TRUNCATE guard, which
--    IS statement-level and genuinely does need its own per-partition loop.
-- 2) Verification loop over pg_inherits (not a hardcoded partition-name
--    list, matching 0027's approach) that RAISEs a WARNING — rather than
--    silently passing — if any existing partition somehow did not inherit
--    the trigger, so a future Postgres-version edge case cannot silently
--    reopen this gap unnoticed.
-- 3) Future partitions: events.create_future_partitions() (0014, patched by
--    0027 for the TRUNCATE guard) creates new partitions via
--    `CREATE TABLE ... PARTITION OF events.events`. Because
--    trg_events_immutable now lives on the parent as a row-level trigger,
--    PostgreSQL clones it onto every partition created this way automatically
--    — the same mechanism as (1), just triggered at partition-creation time
--    instead of migration time. No further change to
--    events.create_future_partitions() is required for THIS guard (unlike
--    the statement-level TRUNCATE guard, which needed the function itself
--    patched in 0027). Confirmed empirically in the PR's verification
--    evidence: a partition created after this migration ran already carried
--    trg_events_immutable with no additional step.
-- 4) Deliberately NOT re-issuing `REVOKE UPDATE, DELETE ON events.events FROM
--    audit_svc` here, even though 0006 did this for the pre-partition table.
--    Two independent reasons, both confirmed empirically while testing this
--    migration:
--      a) Where it would matter (audit_svc genuinely owns events.events —
--         true on a fresh/CI bootstrap per bootstrap.generated.sql's
--         `CREATE SCHEMA events AUTHORIZATION audit_svc`), the REVOKE
--         actually blocks UPDATE/DELETE at the ACL layer BEFORE Postgres
--         ever evaluates the trigger — reproduced live: even on
--         events_legacy, which has carried 0006's original trigger AND its
--         REVOKE completely undisturbed this whole time, `UPDATE
--         events.events_legacy ...` as audit_svc fails with a plain
--         `permission denied for table events_legacy`, never reaching
--         events.reject_audit_mutation(). tests/audit.test.ts's
--         APPEND-ONLY assertion expects the TRIGGER's message
--         (/append-only|not permitted|immutable/i) — a bare ACL denial
--         does not match it, so re-adding this REVOKE would trade one
--         failing assertion (no rejection at all, today's bug) for another
--         (rejected, but with the wrong message) without fixing the
--         underlying test.
--      b) Where the REVOKE would NOT break that message match (the
--         `civitas_admin`-owned "shared dev DB" drift 0027 documents for
--         this same table), audit_svc is a non-owner with no grant option,
--         so the REVOKE is a silent no-op there anyway (degrading to a
--         NOTICE under the same EXCEPTION WHEN insufficient_privilege
--         wrap 0027 uses) — no security benefit in that environment either.
--    Net effect: this REVOKE provides no real protection anywhere it could
--    actually take hold, while actively breaking a passing test in the one
--    environment (fresh/CI) where it does. Skipping it also matches 0027
--    Part 2's own precedent of omitting REVOKE for audit_svc-owned tables.
--    The trigger remains the sole and, per 0006's own comment, "authoritative
--    guard... regardless of role or ownership" — unaffected by this choice.
--
-- Privilege wrinkle found empirically while writing and testing this
-- migration (not anticipated from reading 0027 alone): 0027 Part 1 already
-- ran REVOKE TRUNCATE, TRIGGER ON events.<partition> FROM audit_svc against
-- every partition that existed at 0027's run time. Since these migrations
-- all run as audit_svc (see scripts/ci/bootstrap-postgres.sh's SERVICE_DBS
-- loop), and CREATE TRIGGER on a partitioned PARENT requires the executing
-- role to hold TRIGGER on every partition being cascaded to (not merely on
-- the parent, and ownership does NOT bypass a previously-revoked ACL entry
-- — owner-implicit privileges are real, revocable grants), attempting
-- CREATE TRIGGER directly failed live with
-- `permission denied for table events_y2026m09` even though audit_svc owns
-- that partition outright. Confirmed via has_table_privilege('audit_svc',
-- 'events.events_y2026m09','TRIGGER') = true on the PARENT relation name
-- but the per-partition ACL entry itself was the one 0027 revoked.
-- Fix: audit_svc, as owner of each partition, can always re-GRANT a
-- privilege to itself regardless of a prior REVOKE (ownership rights around
-- GRANT/REVOKE are separate from the ACL-gated DML/DDL rights being
-- granted). So this migration briefly re-GRANTs TRIGGER on every existing
-- partition immediately before creating the trigger on the parent, then
-- REVOKEs TRIGGER again immediately after — restoring 0027's hardening
-- (audit_svc cannot itself DROP the guard trigger) once the one-time DDL
-- window is closed. The trigger, once created, fires regardless of the
-- creating role's privileges afterward, so re-revoking does not weaken
-- anything already in place.
--
-- Rollback:
--   DROP TRIGGER trg_events_immutable ON events.events; (cascades to
--     partitions automatically, same as CREATE did)
-- Affected services: audit-service

SET lock_timeout = '5s';

DO $$
DECLARE
  part_name text;
BEGIN
  -- Step A: briefly re-grant TRIGGER on every existing partition to
  -- audit_svc (see privilege-wrinkle note above) so the CREATE TRIGGER
  -- below can cascade to all of them. audit_svc can always do this to an
  -- object it owns; wrapped anyway in case ownership differs by
  -- environment (see 0027's own ownership-drift note).
  FOR part_name IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = p.relnamespace
    WHERE n.nspname = 'events' AND p.relname = 'events'
  LOOP
    BEGIN
      EXECUTE format('GRANT TRIGGER ON events.%I TO audit_svc', part_name);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'could not re-grant TRIGGER on events.% to audit_svc (insufficient privilege) — CREATE TRIGGER on the parent below may fail to cascade to this partition; apply manually as the table owner if so', part_name;
    END;
  END LOOP;

  -- Step B: create the guard on the parent. FOR EACH ROW, so PostgreSQL
  -- clones it onto every partition found above automatically.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'events.events'::regclass
      AND tgname = 'trg_events_immutable'
      AND NOT tgisinternal
  ) THEN
    BEGIN
      EXECUTE 'CREATE TRIGGER trg_events_immutable BEFORE UPDATE OR DELETE ON events.events FOR EACH ROW EXECUTE FUNCTION events.reject_audit_mutation()';
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'could not create trg_events_immutable on events.events (insufficient privilege) — events.events is NOT protected against direct UPDATE/DELETE; apply manually as the table owner';
    END;
  END IF;

  -- Step C: restore 0027's hardening now that the one-time DDL window is
  -- closed — the trigger fires regardless of the creating role's
  -- privileges from here on, so re-revoking does not weaken anything.
  FOR part_name IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = p.relnamespace
    WHERE n.nspname = 'events' AND p.relname = 'events'
  LOOP
    BEGIN
      EXECUTE format('REVOKE TRIGGER ON events.%I FROM audit_svc', part_name);
    EXCEPTION WHEN insufficient_privilege THEN
      NULL; -- nothing to restore if the grant above never succeeded either
    END;
  END LOOP;

  -- Deliberately no `REVOKE UPDATE, DELETE ON events.events FROM audit_svc`
  -- here — see point (4) in the header comment for why.
END $$;

-- Verification: confirm every existing partition actually inherited the
-- row-level trigger from the parent (see note (2) above). Uses pg_inherits,
-- not a hardcoded partition-name list, so this is correct regardless of
-- exactly which months exist when it runs — same approach 0027 used for the
-- TRUNCATE guard's per-partition loop.
DO $$
DECLARE
  part_name text;
  missing_count int := 0;
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
        AND tgname = 'trg_events_immutable'
        AND NOT tgisinternal
    ) THEN
      missing_count := missing_count + 1;
      RAISE WARNING 'events.% did NOT inherit trg_events_immutable from the parent — this partition is NOT protected against direct UPDATE/DELETE; investigate (unexpected for a FOR EACH ROW trigger on a partitioned parent)', part_name;
    END IF;
  END LOOP;

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'trg_events_immutable is missing on % partition(s) of events.events after CREATE TRIGGER on the parent — see preceding WARNINGs', missing_count;
  END IF;
END $$;
