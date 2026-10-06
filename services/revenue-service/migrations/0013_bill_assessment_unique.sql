-- revenue-service migration 0013 — one bill per assessment (GAP-REVENUE-BILLS-01)
-- Applied AFTER 0012_receipt_idempotency.sql
-- Rollback: DROP INDEX IF EXISTS billing.uq_bills_tenant_assessment;
--
-- GAP-REVENUE-BILLS-01: POST /v1/revenue/bills/generate carries only an
-- assessmentId and the outbox messageId (fresh per publish) is the only
-- idempotency key, so a double-click / retry generates a SECOND bill for the
-- same assessment → the assessee is billed twice and dues are overstated.
--
-- Fix: a per-tenant UNIQUE index on (tenant_id, assessment_id) — one issued
-- bill per assessment per tenant. Scoped per-tenant per this codebase's
-- tenant-scoped-uniqueness convention (see 0006/0012). The consumer checks for
-- an existing bill for the assessment before inserting and no-ops a duplicate;
-- this index is the race-free backstop.
--
-- Pre-existing-duplicate safety: there is no known duplicate-writing path
-- before this fix, but if real duplicate (tenant_id, assessment_id) bill rows
-- already exist the CREATE UNIQUE INDEX below fails LOUDLY. That is correct: a
-- double-issued bill is a financial data-integrity incident a human must
-- resolve. billing.bills is FORCE ROW LEVEL SECURITY, so a silent DELETE-dedup
-- here would be both a no-op for the table owner and the wrong remedy (it
-- would destroy financial rows). Same stance as 0012.

SET lock_timeout = '5s';

DO $$ BEGIN
  CREATE UNIQUE INDEX uq_bills_tenant_assessment
    ON billing.bills (tenant_id, assessment_id);
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
