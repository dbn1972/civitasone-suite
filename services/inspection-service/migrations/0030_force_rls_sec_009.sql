-- SEC-009: RLS ENABLE without FORCE on service-owned tables.
--
-- inspection_svc owns reports.inspection_reports and reports.observations
-- (0025_reports.sql); the owning role silently bypasses its own rls_reports
-- / rls_observations policies without FORCE. See
-- packages/db/src/tenant-scope.ts:20.
--
-- Includes reports.observations even though the SEC-009 gap-report evidence
-- cell names only inspection_reports: 0029_sec_002_rls_isolation.sql's own
-- fix notes explicitly say "reports.inspection_reports/observations (ENABLE
-- without FORCE) intentionally left to SEC-009" -- observations was always
-- meant to be closed here, just dropped from the SEC-009 row's evidence
-- cell. Verified live: both tables are ENABLE-without-FORCE on a fresh
-- bootstrap.
--
-- Rollback (per table): ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY;

ALTER TABLE reports.inspection_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE reports.observations       FORCE ROW LEVEL SECURITY;
