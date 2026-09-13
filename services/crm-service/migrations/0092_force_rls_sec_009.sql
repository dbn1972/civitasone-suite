-- SEC-009: RLS ENABLE without FORCE on service-owned tables.
--
-- crm_svc OWNS these tables (it ran the CREATE TABLE migrations), so without
-- FORCE ROW LEVEL SECURITY the owning role silently bypasses its own
-- tenant_isolation_* policies -- see packages/db/src/tenant-scope.ts:20 for
-- the stated precondition this closes.
--
-- Covers the 8 crm tables named in the SEC-009 gap-report evidence cell,
-- plus two more found while verifying that cell against the actual
-- migrations: crm.subscriptions (0077_subscriptions.sql) and
-- crm.service_requests (0080_service_requests.sql) have the identical
-- ENABLE-without-FORCE gap and a real tenant_isolation_* policy, but were
-- not named in the SEC-009 row. Same undercount pattern SEC-002's own fix
-- flagged in its evidence cell ("corrected ... from 23 to 21"); see the
-- gap-report update in this PR for the recount note.
--
-- Rollback (per table): ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY;

ALTER TABLE crm.pending_campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.canned_responses  FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.commission_rules  FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.commission_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.referrals         FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.appointments      FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.subscriptions     FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.service_requests  FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.grievances        FORCE ROW LEVEL SECURITY;
ALTER TABLE crm.rti_requests      FORCE ROW LEVEL SECURITY;
