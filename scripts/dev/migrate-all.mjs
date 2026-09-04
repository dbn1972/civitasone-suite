#!/usr/bin/env node
/**
 * migrate-all.mjs — apply every service's migrations to its database.
 * Idempotent: all migrations use CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
 *
 * Usage: node scripts/dev/migrate-all.mjs
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

const SERVICES = [
  { name: "admin-service",       db: "civitas_admin" },
  { name: "analytics-service",   db: "civitas_analytics" },
  { name: "asset-service",       db: "civitas_asset" },
  { name: "audit-service",       db: "civitas_audit" },
  { name: "billing-service",     db: "civitas_billing" },
  { name: "citizen-service",     db: "civitas_citizen" },
  { name: "contract-service",    db: "civitas_contract" },
  { name: "crm-service",         db: "civitas_crm" },
  { name: "estab-service",       db: "civitas_estab" },
  { name: "finance-service",     db: "civitas_finance" },
  { name: "grant-service",       db: "civitas_grant" },
  { name: "helpdesk-service",    db: "civitas_helpdesk" },
  { name: "hrms-service",        db: "civitas_hrms" },
  { name: "identity-service",    db: "civitas_identity" },
  { name: "install-service",     db: "civitas_install" },
  { name: "inventory-service",   db: "civitas_inventory" },
  { name: "knowledge-service",   db: "civitas_knowledge" },
  { name: "legal-service",       db: "civitas_legal" },
  { name: "location-service",    db: "civitas_location" },
  { name: "notification-service",db: "civitas_notification" },
  { name: "payroll-service",     db: "civitas_payroll" },
  { name: "plugin-service",      db: "civitas_plugin" },
  { name: "policy-service",      db: "civitas_policy" },
  { name: "procurement-service", db: "civitas_procurement" },
  { name: "project-service",     db: "civitas_project" },
  { name: "report-service",      db: "civitas_report" },
  { name: "stock-service",       db: "civitas_stock" },
  { name: "telephony-service",   db: "civitas_telephony" },
  { name: "tenant-service",      db: "civitas_tenant" },
  { name: "theme-service",       db: "civitas_theme" },
  { name: "workflow-service",    db: "civitas_workflow" },
  // Customer-engagement platform services. These were absent from this list, so
  // `migrate-all` never created their schemas and the services had no database
  // to talk to.
  { name: "cdp-service",            db: "civitas_cdp" },
  { name: "catalogue-service",      db: "civitas_catalogue" },
  { name: "journey-service",        db: "civitas_journey" },
  { name: "field-service",          db: "civitas_field" },
  { name: "loyalty-service",        db: "civitas_loyalty" },
  { name: "recommendation-service", db: "civitas_recommendation" },
  { name: "ai-agent-service",       db: "civitas_ai_agent" },
  // Async-infra fleet-stitching fix: these services were started manually via
  // pm2/ecosystem.config.js but were never added here, so their databases were
  // never provisioned by migrate-all and hand-run hotfixes (e.g. the
  // revenue-service outbox/inbox tables) would vanish on any DB rebuild.
  { name: "revenue-service",    db: "civitas_revenue" },
  { name: "court-service",      db: "civitas_court" },
  { name: "meeting-service",    db: "civitas_meeting" },
  { name: "ml-service",         db: "civitas_ml" },
  { name: "inspection-service", db: "civitas_inspection" },
  // Critical async-infra: visitor/works were declared in ecosystem.config.js but
  // absent here, so migrate-all never provisioned civitas_visitor / civitas_works
  // and queue-first writes failed closed on startup.
  { name: "visitor-service",    db: "civitas_visitor" },
  { name: "works-service",      db: "civitas_works" },
  { name: "metadata-service",   db: "civitas_metadata" },
  // Gateway owns civitas_gateway (api catalogue). Was the only service with a
  // migrations/ dir missing from this list.
  { name: "gateway-service",    db: "civitas_gateway" },
  // Municipal Sec5 — of the 17 BRD Sec5 scaffolds (see ecosystem.config.js),
  // only advertisement-service, animal-service, and vendor-service ship a
  // migrations/0001_initial.sql; the other 14 have no migrations directory at
  // all yet. All three below are now wired into ecosystem.config.js / gateway
  // registry.ts (re-verified 2026-08-27, all 17 typecheck/build clean), so all
  // three need to be here too or migrate-all never provisions their schemas.
  { name: "advertisement-service", db: "civitas_advertisement" },
  { name: "animal-service",        db: "civitas_animal" },
  { name: "vendor-service",        db: "civitas_vendor" },
  // Municipal Sec5 batch 2 (deep-verification pass, 2026-08-27): these 5 had
  // no migrations/0001_initial.sql either — same gap as the 11 other Sec5
  // scaffolds still missing one. Written to match each service's
  // src/modules/*/schema.ts exactly (see PR adding these 5 migration files).
  { name: "parks-service",   db: "civitas_parks" },
  { name: "refund-service",  db: "civitas_refund" },
  { name: "roadcut-service", db: "civitas_roadcut" },
  { name: "shop-service",    db: "civitas_shop" },
  { name: "trade-service",   db: "civitas_trade" },
  // Municipal Sec5 batch 3 (deep-verification pass, 2026-08-27): all 6
  // municipal services in this batch (crematorium, drainage, event, fire,
  // market, parking) had no migrations/0001_initial.sql either, until this
  // same pass wrote them — CI's migrate-all-inventory test caught this
  // directly (parking-service PR #799: "expected ['parking-service'] to
  // deeply equal []"). fire-service (#825) already merged to main without
  // this entry, so this also backfills that gap.
  { name: "crematorium-service", db: "civitas_crematorium" },
  { name: "drainage-service",    db: "civitas_drainage" },
  { name: "event-service",       db: "civitas_event" },
  { name: "fire-service",        db: "civitas_fire" },
  { name: "market-service",      db: "civitas_market" },
  { name: "parking-service",     db: "civitas_parking" },
  // building-service: no migrations/ directory yet (added in a separate,
  // parallel change) -- registered now so local dev tooling picks it up the
  // moment that migration lands, without a second edit. existsSync guard
  // above makes this a no-op until then.
  { name: "building-service",    db: "civitas_building" },
  // sewerage-service, swm-service: pre-existing gap found while wiring the
  // municipal batch-4 services above -- both shipped real migrations
  // tonight (PRs #988/#989) and are correctly registered in
  // scripts/ci/bootstrap-postgres.sh's SERVICE_DBS map, but neither was
  // ever added here, so tests/ops/migrate-all-inventory.test.ts (the
  // Architecture Guard CI gate) failed on main before this fix.
  { name: "sewerage-service",     db: "civitas_sewerage" },
  { name: "swm-service",          db: "civitas_swm" },
];

let applied = 0;
let skipped = 0;
let errors  = 0;

for (const svc of SERVICES) {
  const migrationsDir = join(ROOT, "services", svc.name, "migrations");
  if (!existsSync(migrationsDir)) {
    console.log(`[skip] ${svc.name}: no migrations dir`);
    skipped++;
    continue;
  }

  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log(`[skip] ${svc.name}: no SQL files`);
    skipped++;
    continue;
  }

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    const sql = readFileSync(filePath);
    try {
      execSync(
        `docker exec -i civitasone-postgres psql -U civitas_admin -d ${svc.db} -v ON_ERROR_STOP=1`,
        { input: sql, stdio: ["pipe", "pipe", "pipe"] }
      );
      console.log(`[ok]   ${svc.name}/${file} → ${svc.db}`);
      applied++;
    } catch (err) {
      const stderr = err.stderr?.toString() ?? "";
      const stdout = err.stdout?.toString() ?? "";
      const combined = stderr + stdout;
      if (combined.includes("already exists") && !combined.includes("ERROR")) {
        console.log(`[idem] ${svc.name}/${file} (already applied)`);
        applied++;
      } else {
        // Fail loud AND stop: a broken migration used to be logged as [ERR]
        // and the loop just kept going onto the service's LATER migrations
        // (which often depend on the failed one), silently leaving the
        // schema half-applied while the script kept chugging. Abort this
        // service's remaining migrations immediately so a failure can never
        // hide behind a wall of unrelated [ok] lines further down the log.
        console.error(`
════════════════════════════════════════════════════`);
        console.error(`[ERR]  ${svc.name}/${file}: ${combined.trim().slice(0, 300)}`);
        console.error(`[ABORT] ${svc.name}: skipping remaining migrations for this service after failure above`);
        console.error(`════════════════════════════════════════════════════
`);
        errors++;
        break;
      }
    }
  }
}

console.log(`\n── Migration summary ──────────────────`);
console.log(`Applied : ${applied}`);
console.log(`Skipped : ${skipped}`);
console.log(`Errors  : ${errors}`);
if (errors > 0) process.exit(1);

console.log("\nApplying service role grants...");
try {
  execSync("node scripts/dev/grant-all.mjs", { cwd: ROOT, stdio: "inherit" });
} catch {
  errors++;
}
