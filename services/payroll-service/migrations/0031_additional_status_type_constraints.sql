-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: payroll-service

SET lock_timeout = '5s';

-- ============================================================================
-- payroll.payroll_components.component_type
-- Valid states: earning, deduction (schema default "earning"; consumer.ts
-- casts componentType to "earning" | "deduction" when building rawComponents
-- for the payroll engine; domain.ts PayComponent/RawComponent.type is typed
-- as the same union; seed-all.mjs seeds only "earning")
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payroll.payroll_components
    ADD CONSTRAINT payroll_components_component_type_check
    CHECK (component_type IN ('earning', 'deduction'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- loans.payroll_loans.loan_type
-- SKIPPED: loan_type is a free-form varchar(32) with no zod enum. validators.ts
-- (createLoanBody) only requires z.string().max(32).default("personal");
-- consumer.ts (loans/consumer.ts) passes loanType through verbatim with no
-- branching on value. Only "personal" appears in tests/seed data, but that is
-- the default value, not an exhaustive enumeration (other services, e.g.
-- hrms-service loans-routes.ts, define their own separate LOAN_TYPES enum
-- for a different table — not shared with this column). No bounded set could
-- be determined without guessing. Not constrained.
-- ============================================================================

-- ============================================================================
-- statutory.payroll_tds_challan.form_type
-- Valid states: 24Q, 26Q (statutory-returns/challan-routes.ts: every read/write
-- path narrows formType via `formType === "26Q" ? "26Q" : "24Q"`; schema
-- default is "24Q". 12BA appears elsewhere in statutory-returns/routes.ts but
-- only as a report label in a response payload, never written to this column.)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE statutory.payroll_tds_challan
    ADD CONSTRAINT payroll_tds_challan_form_type_check
    CHECK (form_type IN ('24Q', '26Q'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payroll.form16_bulk_jobs.status — CORRECTED (bug in migration 0027).
-- The existing constraint form16_bulk_jobs_status_check (added in 0027) only
-- allows ('pending', 'generating', 'completed', 'failed'), but the actual
-- writers are form16-pdf/routes.ts (inserts 'pending') and
-- form16-pdf/bulk-consumer.ts (transitions to 'processing' on job start, then
-- 'completed'/'failed') — 'generating' is never written and 'processing' is
-- missing, meaning every bulk job transition to 'processing' would violate
-- the existing NOT VALID constraint on new writes. Replace it with the
-- correct value set.
-- ============================================================================
ALTER TABLE payroll.form16_bulk_jobs
  DROP CONSTRAINT IF EXISTS form16_bulk_jobs_status_check;

DO $$ BEGIN
  ALTER TABLE payroll.form16_bulk_jobs
    ADD CONSTRAINT form16_bulk_jobs_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payroll.fnf_settlements.separation_type
-- Valid states: retirement, superannuation, resignation, retrenchment, vrs,
-- death (fnf/routes.ts computeFnfBody/internalBreakdownQuery: separationType
-- z.enum([...]); domain.ts SeparationType type from tax/fnf-exemptions.js)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payroll.fnf_settlements
    ADD CONSTRAINT fnf_settlements_separation_type_check
    CHECK (separation_type IN ('retirement', 'superannuation', 'resignation', 'retrenchment', 'vrs', 'death'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payroll.fnf_settlements.status
-- SKIPPED: a CHECK constraint (fnf_settlements_status_check) already exists
-- on this column from migration 0027, covering ('draft', 'computed',
-- 'approved', 'paid', 'cancelled'). fnf/consumer.ts only ever writes 'draft'
-- on settlement creation today (no approve/pay/cancel transition exists yet
-- in this module), so the existing broader constraint already covers every
-- value this column can currently hold. Do NOT add a second CHECK here — see
-- notification-service precedent (0008 migration) for why a duplicate/
-- narrower CHECK on an already-constrained column is unsafe. Nothing added.
-- ============================================================================

-- ============================================================================
-- payroll.ltc_exemptions.ltc_type
-- Valid states: hometown, all_india (tax/ltc-exemption.ts LtcExemptionInput.
-- ltcType: "hometown" | "all_india"; integration/consumer.ts casts payload
-- ltcType to the same union before inserting into this table; tests only use
-- these two values)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payroll.ltc_exemptions
    ADD CONSTRAINT ltc_exemptions_ltc_type_check
    CHECK (ltc_type IN ('hometown', 'all_india'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE payroll.payroll_components VALIDATE CONSTRAINT payroll_components_component_type_check;
ALTER TABLE statutory.payroll_tds_challan VALIDATE CONSTRAINT payroll_tds_challan_form_type_check;
ALTER TABLE payroll.form16_bulk_jobs VALIDATE CONSTRAINT form16_bulk_jobs_status_check;
ALTER TABLE payroll.fnf_settlements VALIDATE CONSTRAINT fnf_settlements_separation_type_check;
ALTER TABLE payroll.ltc_exemptions VALIDATE CONSTRAINT ltc_exemptions_ltc_type_check;
