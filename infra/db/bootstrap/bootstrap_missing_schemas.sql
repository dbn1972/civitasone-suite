-- bootstrap_missing_schemas.sql
--
-- Purpose: create the module schemas that migrations reference but that no
-- bootstrap file ever created. Run AFTER the other bootstrap files and BEFORE the
-- migration loop.
--
-- DEFECT THIS FIXES (P0, CI)
-- Measured by running scripts/ci/bootstrap-postgres.sh against a throwaway
-- postgres:16-alpine container: 97 migrations failed, and `schema "X" does not
-- exist` was the single largest cause (30 of them). Because the migration loop
-- logged a warning and continued, the bootstrap still reported success, so every
-- table those migrations would have created was simply absent — the same
-- population the schema-drift guard reports as 231 declared-but-missing columns
-- (location 92, tenant 51, plugin 34, theme 27, policy 9 …).
--
-- Invisible on developer machines because these schemas were created there by
-- hand at some point, outside version control. A fresh cluster never had them.
--
-- Schemas and owning roles are taken from the failing migrations themselves, not
-- guessed. AUTHORIZATION follows the convention in bootstrap.generated.sql: one
-- schema per bounded-context module, owned by the service role.
--
-- Rollback: DROP SCHEMA IF EXISTS <name> CASCADE per entry, per database.
--   (Destructive once migrations have populated them. Prefer forward fixes.)
--
-- Idempotent: every statement is IF NOT EXISTS. Safe to re-run.

\connect civitas_tenant
CREATE SCHEMA IF NOT EXISTS plans         AUTHORIZATION tenant_svc;
CREATE SCHEMA IF NOT EXISTS subscriptions AUTHORIZATION tenant_svc;

\connect civitas_policy
CREATE SCHEMA IF NOT EXISTS role_features AUTHORIZATION policy_svc;

\connect civitas_audit
CREATE SCHEMA IF NOT EXISTS vigilance     AUTHORIZATION audit_svc;

\connect civitas_procurement
CREATE SCHEMA IF NOT EXISTS procurement   AUTHORIZATION procurement_svc;

\connect civitas_citizen
CREATE SCHEMA IF NOT EXISTS citizen       AUTHORIZATION citizen_svc;

\connect civitas_admin
CREATE SCHEMA IF NOT EXISTS admin          AUTHORIZATION admin_svc;
CREATE SCHEMA IF NOT EXISTS custom_domains AUTHORIZATION admin_svc;
CREATE SCHEMA IF NOT EXISTS scheduled_jobs AUTHORIZATION admin_svc;

\connect civitas_location
CREATE SCHEMA IF NOT EXISTS geofence     AUTHORIZATION location_svc;
CREATE SCHEMA IF NOT EXISTS hierarchy    AUTHORIZATION location_svc;
CREATE SCHEMA IF NOT EXISTS jurisdiction AUTHORIZATION location_svc;

\connect civitas_asset
CREATE SCHEMA IF NOT EXISTS asset AUTHORIZATION asset_svc;

\connect civitas_hrms
CREATE SCHEMA IF NOT EXISTS hrms    AUTHORIZATION hrms_svc;
CREATE SCHEMA IF NOT EXISTS payroll AUTHORIZATION hrms_svc;

\connect civitas_theme
CREATE SCHEMA IF NOT EXISTS theme    AUTHORIZATION theme_svc;
CREATE SCHEMA IF NOT EXISTS branding AUTHORIZATION theme_svc;

\connect civitas_plugin
CREATE SCHEMA IF NOT EXISTS plugin AUTHORIZATION plugin_svc;
CREATE SCHEMA IF NOT EXISTS hooks  AUTHORIZATION plugin_svc;
