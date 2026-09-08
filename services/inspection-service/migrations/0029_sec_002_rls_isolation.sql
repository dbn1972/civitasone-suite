-- SEC-002: 21 inspection-service tenant tables had NO Row Level Security at
-- all (no ENABLE, no FORCE, no policy) — cross-tenant reads/writes were only
-- ever prevented by application-layer `WHERE tenant_id = $1` clauses, with no
-- database-level backstop. Verified directly against every migration file in
-- this directory (0001-0028): the tables below have zero RLS-related
-- statements anywhere in the migration history, unlike universe/risk/
-- planning/assignment/checklist/sync/evidence/execution/findings (0001-0009,
-- already ENABLE+FORCE+policy) and reports.inspection_reports/observations
-- (0025, ENABLE but not FORCE — that gap is tracked separately as SEC-009,
-- deliberately left untouched here).
--
-- Verification note: the gap report (docs/ENTERPRISE-GAP-REPORT-2026-09-07.md,
-- SEC-002 row) says "23 tables" and cites "migrations 0012...0027"; a full
-- read of every migration file found 21 concrete tenant tables with no RLS,
-- one of which (capa.corrective_actions) was actually created in 0011, just
-- outside the cited range. No 22nd/23rd table was found; the discrepancy is
-- called out in the PR rather than silently forced to match.
--
-- encroachment.* (0026) and illegal_construction.* (0027) each carry a code
-- comment asserting "no RLS, tenant isolation at the application layer only
-- ... not a new decision, consistent with the sibling schema [enforcement]
-- this module was modeled on." That was a deliberate choice at the time, but
-- it is exactly the defense-in-depth gap packages/db/src/tenant-scope.ts
-- (SAST-003) and this gap-closure programme exist to remove fleet-wide; this
-- migration supersedes that earlier decision for both schemas.
--
-- Convention: matches the majority in-service pattern used by
-- migrations 0002/0004/0005/0006/0008/0009 (ENABLE + FORCE + a
-- `tenant_isolation` policy using the session GUC directly, fail-closed via
-- NULLIF so a missing/empty GUC denies all rows instead of erroring) rather
-- than the earlier per-schema current_tenant_id() wrapper function used only
-- by 0001/0007. Also matches document-service's 0002_rls_tenant_isolation.sql
-- and packages/db/src/tenant-scope.ts's documented predicate shape. The GUC
-- (`app.tenant_id`) is set per-transaction by @civitasone/db's
-- createTenantDb()/runWithTenant() — see services/inspection-service/src/shared/db.ts.
--
-- Additive, idempotent (DROP POLICY IF EXISTS before CREATE; ENABLE/FORCE are
-- no-ops when already set). Safe to re-run.
--
-- Rollback (per table): ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY;
--                        ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;
--                        DROP POLICY IF EXISTS tenant_isolation ON <t>;
-- Affected services: inspection-service

SET lock_timeout = '5s';

-- capa.corrective_actions (0011)
ALTER TABLE capa.corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE capa.corrective_actions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON capa.corrective_actions;
CREATE POLICY tenant_isolation ON capa.corrective_actions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- enforcement.* (0012)
ALTER TABLE enforcement.penalty_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE enforcement.penalty_rates FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enforcement.penalty_rates;
CREATE POLICY tenant_isolation ON enforcement.penalty_rates
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE enforcement.show_cause_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE enforcement.show_cause_notices FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enforcement.show_cause_notices;
CREATE POLICY tenant_isolation ON enforcement.show_cause_notices
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE enforcement.penalty_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE enforcement.penalty_orders FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enforcement.penalty_orders;
CREATE POLICY tenant_isolation ON enforcement.penalty_orders
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE enforcement.prosecution_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE enforcement.prosecution_referrals FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON enforcement.prosecution_referrals;
CREATE POLICY tenant_isolation ON enforcement.prosecution_referrals
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- licence.* (0013)
ALTER TABLE licence.licences ENABLE ROW LEVEL SECURITY;
ALTER TABLE licence.licences FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON licence.licences;
CREATE POLICY tenant_isolation ON licence.licences
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE licence.licence_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE licence.licence_conditions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON licence.licence_conditions;
CREATE POLICY tenant_isolation ON licence.licence_conditions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- survey.* (0014)
ALTER TABLE survey.survey_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey.survey_definitions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON survey.survey_definitions;
CREATE POLICY tenant_isolation ON survey.survey_definitions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE survey.sampling_frames ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey.sampling_frames FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON survey.sampling_frames;
CREATE POLICY tenant_isolation ON survey.sampling_frames
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE survey.survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey.survey_responses FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON survey.survey_responses;
CREATE POLICY tenant_isolation ON survey.survey_responses
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE survey.survey_aggregations ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey.survey_aggregations FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON survey.survey_aggregations;
CREATE POLICY tenant_isolation ON survey.survey_aggregations
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- telemetry.* (0015)
ALTER TABLE telemetry.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry.devices FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON telemetry.devices;
CREATE POLICY tenant_isolation ON telemetry.devices
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE telemetry.telemetry_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry.telemetry_readings FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON telemetry.telemetry_readings;
CREATE POLICY tenant_isolation ON telemetry.telemetry_readings
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE telemetry.telemetry_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry.telemetry_alerts FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON telemetry.telemetry_alerts;
CREATE POLICY tenant_isolation ON telemetry.telemetry_alerts
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE telemetry.alert_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry.alert_rules FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON telemetry.alert_rules;
CREATE POLICY tenant_isolation ON telemetry.alert_rules
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- encroachment.* (0026) — supersedes that migration's "app-layer only" note
ALTER TABLE encroachment.encroachment_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE encroachment.encroachment_complaints FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON encroachment.encroachment_complaints;
CREATE POLICY tenant_isolation ON encroachment.encroachment_complaints
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE encroachment.encroachment_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE encroachment.encroachment_notices FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON encroachment.encroachment_notices;
CREATE POLICY tenant_isolation ON encroachment.encroachment_notices
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE encroachment.encroachment_hearings ENABLE ROW LEVEL SECURITY;
ALTER TABLE encroachment.encroachment_hearings FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON encroachment.encroachment_hearings;
CREATE POLICY tenant_isolation ON encroachment.encroachment_hearings
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE encroachment.encroachment_removals ENABLE ROW LEVEL SECURITY;
ALTER TABLE encroachment.encroachment_removals FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON encroachment.encroachment_removals;
CREATE POLICY tenant_isolation ON encroachment.encroachment_removals
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- illegal_construction.* (0027) — supersedes that migration's "app-layer only" note
ALTER TABLE illegal_construction.illegal_construction_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE illegal_construction.illegal_construction_cases FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON illegal_construction.illegal_construction_cases;
CREATE POLICY tenant_isolation ON illegal_construction.illegal_construction_cases
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE illegal_construction.illegal_construction_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE illegal_construction.illegal_construction_actions FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON illegal_construction.illegal_construction_actions;
CREATE POLICY tenant_isolation ON illegal_construction.illegal_construction_actions
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
