-- E2E test role provisioning: per-service least-privileged roles
-- These roles are NOSUPERUSER NOBYPASSRLS so RLS enforcement is verified.
-- Migrations run as civitasone (superuser); RUNTIME connects as <svc>_svc.

-- Service databases
CREATE DATABASE civitas_identity;
CREATE DATABASE civitas_finance;
CREATE DATABASE civitas_procurement;
CREATE DATABASE civitas_hrms;

-- Service roles (NOSUPERUSER, NOBYPASSRLS)
CREATE ROLE identity_svc LOGIN PASSWORD 'identity_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE finance_svc LOGIN PASSWORD 'finance_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE procurement_svc LOGIN PASSWORD 'procurement_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE hrms_svc LOGIN PASSWORD 'hrms_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE citizen_svc LOGIN PASSWORD 'citizen_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE payroll_svc LOGIN PASSWORD 'payroll_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE grant_svc LOGIN PASSWORD 'grant_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE billing_svc LOGIN PASSWORD 'billing_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE admin_svc LOGIN PASSWORD 'admin_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE workflow_svc LOGIN PASSWORD 'workflow_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE tenant_svc LOGIN PASSWORD 'tenant_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE policy_svc LOGIN PASSWORD 'policy_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE audit_svc LOGIN PASSWORD 'audit_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE notification_svc LOGIN PASSWORD 'notification_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE asset_svc LOGIN PASSWORD 'asset_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE stock_svc LOGIN PASSWORD 'stock_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE project_svc LOGIN PASSWORD 'project_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE estab_svc LOGIN PASSWORD 'estab_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE legal_svc LOGIN PASSWORD 'legal_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE contract_svc LOGIN PASSWORD 'contract_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE crm_svc LOGIN PASSWORD 'crm_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE inventory_svc LOGIN PASSWORD 'inventory_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE telephony_svc LOGIN PASSWORD 'telephony_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE helpdesk_svc LOGIN PASSWORD 'helpdesk_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE knowledge_svc LOGIN PASSWORD 'knowledge_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE report_svc LOGIN PASSWORD 'report_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE plugin_svc LOGIN PASSWORD 'plugin_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE theme_svc LOGIN PASSWORD 'theme_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE install_svc LOGIN PASSWORD 'install_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE analytics_svc LOGIN PASSWORD 'analytics_svc_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE location_svc LOGIN PASSWORD 'location_svc_pw' NOSUPERUSER NOBYPASSRLS;

-- Grant CONNECT on databases
GRANT CONNECT ON DATABASE civitas_identity TO identity_svc;
GRANT CONNECT ON DATABASE civitas_finance TO finance_svc;
GRANT CONNECT ON DATABASE civitas_procurement TO procurement_svc;
GRANT CONNECT ON DATABASE civitas_hrms TO hrms_svc;

-- Grant schema usage and table privileges for each service DB.
-- In the E2E environment all services share the postgres instance;
-- each service role gets full DML on its database (no DDL — migrations
-- run as the civitasone superuser).

-- identity
\c civitas_identity
GRANT USAGE ON SCHEMA public TO identity_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO identity_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO identity_svc;

-- finance
\c civitas_finance
GRANT USAGE ON SCHEMA public TO finance_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO finance_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO finance_svc;

-- procurement
\c civitas_procurement
GRANT USAGE ON SCHEMA public TO procurement_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO procurement_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO procurement_svc;

-- hrms
\c civitas_hrms
GRANT USAGE ON SCHEMA public TO hrms_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hrms_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hrms_svc;
