-- 0154_uc_scheme_code.sql
-- GAP-FINANCE-EXPENDITURE-UTILIZATION-CERTIFICATES-NEW-03 / GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-05:
-- a utilisation certificate had no scheme of its own. The scheme chosen on the New UC form was written into
-- grant_ref (and was dropped whenever the officer also typed a grant reference), and the scheme detail page then
-- matched UCs to a scheme by comparing free text with the scheme NAME (not unique per tenant).
-- scheme_code stores the Scheme Tracking code (budget.finance_schemes.code, UNIQUE per tenant) the certificate was raised
-- against. Nullable: certificates raised before this migration, and tenants with no schemes, carry none; the register
-- keeps matching those by the legacy name comparison. No cross-schema FK (L2); the consumer validates the code.
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP INDEX IF EXISTS payments.idx_finance_uc_scheme; ALTER TABLE payments.finance_uc DROP COLUMN IF EXISTS scheme_code;

SET lock_timeout = '5s';

ALTER TABLE payments.finance_uc ADD COLUMN IF NOT EXISTS scheme_code text;

CREATE INDEX IF NOT EXISTS idx_finance_uc_scheme ON payments.finance_uc (tenant_id, scheme_code) WHERE scheme_code IS NOT NULL;
