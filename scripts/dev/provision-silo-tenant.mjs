#!/usr/bin/env node
/**
 * provision-silo-tenant.mjs — provision a SILO tenant's dedicated database.
 *
 * Option B: a silo tenant has ONE physical database that hosts EVERY service's
 * pg schema (budget, gl, files, hrms, …). This creates that DB and applies all
 * services' migrations into it, so every service can connect there and use its
 * own schema. Idempotent (migrations are CREATE … IF NOT EXISTS).
 *
 * Usage:
 *   node scripts/dev/provision-silo-tenant.mjs <tenantUuid> [dbName]
 *
 * Connection: uses the dev Postgres container (docker exec civitasone-postgres
 * psql -U civitas_admin). In production this runs as a privileged ops/CI job
 * with the cluster admin DSN — a microservice never holds CREATE DATABASE creds.
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const PG = "docker exec -i civitasone-postgres psql -U civitas_admin";

// Service migration set (the order is irrelevant — each owns a distinct schema).
const SERVICES = [
  "admin-service", "analytics-service", "asset-service", "audit-service",
  "billing-service", "citizen-service", "contract-service", "crm-service",
  "estab-service", "finance-service", "grant-service", "helpdesk-service",
  "hrms-service", "identity-service", "install-service", "inventory-service",
  "knowledge-service", "legal-service", "location-service", "notification-service",
  "payroll-service", "plugin-service", "policy-service", "procurement-service",
  "project-service", "report-service", "stock-service", "telephony-service",
  "tenant-service", "theme-service", "workflow-service",
];

const tenantId = process.argv[2];
if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
  console.error("Usage: node scripts/dev/provision-silo-tenant.mjs <tenantUuid> [dbName]");
  process.exit(1);
}
const shortId = tenantId.replace(/-/g, "").slice(0, 16);
const dbName = process.argv[3] ?? `civitas_tenant_${shortId}`;

function psql(db, sql) {
  return execSync(`${PG}${db ? ` -d ${db}` : ""}`, { input: sql, stdio: ["pipe", "pipe", "pipe"] }).toString();
}

console.log(`\n── Provisioning silo tenant ${tenantId} → DB ${dbName} ──\n`);

// 1) Create the database if it does not already exist.
const exists = psql("postgres", `SELECT 1 FROM pg_database WHERE datname = '${dbName}';`).includes("1");
if (exists) {
  console.log(`[idem] database ${dbName} already exists`);
} else {
  psql("postgres", `CREATE DATABASE ${dbName};`);
  console.log(`[ok]   created database ${dbName}`);
}

// 2) Apply every service's migrations into the tenant DB (all schemas, one DB).
let applied = 0, idem = 0, errors = 0;
for (const svc of SERVICES) {
  const dir = join(ROOT, "services", svc, "migrations");
  if (!existsSync(dir)) continue;
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(dir, file));
    try {
      psql(dbName, sql.toString());
      applied++;
    } catch (err) {
      const out = (err.stderr?.toString() ?? "") + (err.stdout?.toString() ?? "");
      if (out.includes("already exists") && !out.includes("ERROR:")) { idem++; }
      else { console.error(`[ERR] ${svc}/${file}: ${out.trim().slice(0, 200)}`); errors++; }
    }
  }
}

console.log(`\n── Summary ──`);
console.log(`DB        : ${dbName}`);
console.log(`Applied   : ${applied}`);
console.log(`Idempotent: ${idem}`);
console.log(`Errors    : ${errors}`);
if (errors > 0) process.exit(1);
console.log(`\n✓ Silo tenant ${tenantId} provisioned. Set TENANT_SILO_IDS += ${tenantId} and`);
console.log(`  TENANT_SILO_DSN_TEMPLATE so services route it to ${dbName}.`);
