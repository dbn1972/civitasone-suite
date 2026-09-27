-- Migration 0041: indent budget-consumption tracking (committed_minor)
--
-- CRITICAL FIX: po/consumer.ts's poCreate handler never looked up the indent
-- referenced by a PO at all -- indentRef was stored as a completely
-- unvalidated opaque string, with no check against the indent's approved
-- total_minor and no tracking of how much of an indent had already been
-- consumed by prior POs. Confirmed live: a PO for Rs 900 succeeded against a
-- Rs 500 *approved* indent (80% over budget, no rejection), and a genuine
-- concurrency test showed two simultaneous PO-creation requests against one
-- fresh Rs 900 indent BOTH succeeding -- Rs 1,800 total committed against a
-- Rs 900 ceiling. gemOrderCreate (same table, different entry point) had the
-- identical gap.
--
-- Mirrors finance-service's budget.finance_budget_allocation pattern
-- (allocated_minor / committed_minor / actual_minor, addCommittedGuarded,
-- chk_allocation_no_overcommit -- see
-- services/finance-service/migrations/0056_allocation_no_overcommit.sql and
-- src/modules/budget/allocation-repo.ts) for cross-codebase consistency:
-- committed_minor tracks the sum of non-cancelled POs raised against this
-- indent; available headroom = total_minor - committed_minor. Zero
-- tolerance, hard block -- this platform's GFR library
-- (modules/gfr/mode-bands.ts) governs procurement-MODE selection by value
-- band only and has no documented overrun-percentage exception for a PO
-- against its indent, and finance's own removal of a soft "enforce" bypass
-- (migrations/0067_drop_allocation_enforce.sql) establishes that a
-- silently-relaxable government financial ceiling does not fit this
-- platform's compliance model.
--
-- Backfill sums EXISTING po.procurement_pos rows whose indent_ref resolves
-- to each indent (parsing the "procurement_indent:<uuid>" reference format
-- the app has always used -- see apps/web's CreatePOForm.tsx and
-- po/consumer.ts's checkSanctionAvailable, which applies the identical
-- ref-parsing idiom to sanctionRef), so the counter is accurate from the
-- moment this migration lands, not just for POs created after it. A dev-DB
-- audit before this migration found 21 indents / 22 POs and ZERO
-- pre-existing over-committed indents in this environment's shared DB, so
-- there is nothing to reconcile here -- the backfill is defense-in-depth for
-- any other environment that already carries data.

ALTER TABLE indent.procurement_indents
  ADD COLUMN IF NOT EXISTS committed_minor bigint NOT NULL DEFAULT 0;

UPDATE indent.procurement_indents i
   SET committed_minor = sub.sum_minor
  FROM (
    SELECT substring(p.indent_ref FROM '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')::uuid AS indent_id,
           SUM(p.total_minor) AS sum_minor
      FROM po.procurement_pos p
     WHERE p.status <> 'cancelled'
       AND p.indent_ref ~ '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     GROUP BY 1
  ) sub
 WHERE i.id = sub.indent_id
   AND i.committed_minor = 0;

-- L1: prevent committed exceeding the indent's approved total at the DB
-- level (mirrors chk_allocation_no_overcommit). PostgreSQL CHECK constraints
-- cannot be DEFERRABLE -- see finance's 0056 migration note; this is
-- defense-in-depth behind the app-level addIndentCommittedGuarded() guard in
-- indent/repo.ts, which is the sole gate that actually fires in normal
-- operation and produces the clean INDENT_BUDGET_EXCEEDED domain error.
DO $$ BEGIN
  ALTER TABLE indent.procurement_indents
    ADD CONSTRAINT chk_indent_no_overcommit
    CHECK (committed_minor <= total_minor);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE indent.procurement_indents
    ADD CONSTRAINT chk_indent_committed_nonnegative
    CHECK (committed_minor >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
