#!/usr/bin/env node
/**
 * grant-all.mjs — grant service role access to all non-system schemas in its database.
 * Migrations run as civitas_admin; services connect as *_svc roles.
 */
import { execSync } from "node:child_process";

const DB_USERS = {
  civitas_admin: "admin_svc",
  civitas_analytics: "analytics_svc",
  civitas_asset: "asset_svc",
  civitas_audit: "audit_svc",
  civitas_billing: "billing_svc",
  civitas_citizen: "citizen_svc",
  civitas_contract: "contract_svc",
  civitas_crm: "crm_svc",
  civitas_estab: "estab_svc",
  civitas_finance: "finance_svc",
  civitas_grant: "grant_svc",
  civitas_helpdesk: "helpdesk_svc",
  civitas_hrms: "hrms_svc",
  civitas_identity: "identity_svc",
  civitas_install: "install_svc",
  civitas_inventory: "inventory_svc",
  civitas_knowledge: "knowledge_svc",
  civitas_legal: "legal_svc",
  civitas_location: "location_svc",
  civitas_notification: "notification_svc",
  civitas_payroll: "payroll_svc",
  civitas_plugin: "plugin_svc",
  civitas_policy: "policy_svc",
  civitas_procurement: "procurement_svc",
  civitas_project: "project_svc",
  civitas_report: "report_svc",
  civitas_stock: "stock_svc",
  civitas_telephony: "telephony_svc",
  civitas_tenant: "tenant_svc",
  civitas_theme: "theme_svc",
  civitas_workflow: "workflow_svc",
};

const GRANT_SQL = (role) => `
DO $$
DECLARE s RECORD;
BEGIN
  FOR s IN
    SELECT nspname FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_%'
      AND nspname NOT IN ('information_schema', 'public')
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO ${role}', s.nspname);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO ${role}', s.nspname);
    EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO ${role}', s.nspname);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO ${role}', s.nspname);
  END LOOP;
END $$;
`;

let errors = 0;
for (const [db, role] of Object.entries(DB_USERS)) {
  try {
    execSync(
      `docker exec -i civitasone-postgres psql -U civitas_admin -d ${db} -v ON_ERROR_STOP=1`,
      { input: GRANT_SQL(role), stdio: ["pipe", "pipe", "pipe"] },
    );
    console.log(`[ok] grants → ${db} (${role})`);
  } catch (err) {
    const msg = ((err.stderr ?? "") + (err.stdout ?? "")).toString().trim();
    console.error(`[ERR] grants ${db}: ${msg.slice(0, 200)}`);
    errors++;
  }
}
if (errors > 0) process.exit(1);
