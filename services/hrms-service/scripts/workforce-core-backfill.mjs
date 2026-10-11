#!/usr/bin/env node
/**
 * Workforce Core backfill & mapping tool — CLI (SmartTransfer OS, ST-M01-08).
 *
 * Spec §4, §19. Decisions D-ST-01, 02, 03, 23. DRY RUN FIRST.
 *
 * Reads the three legacy sanctioned-post fragments (manpower.plans +
 * reservation.hrms_sanctioned_posts from this service's own DB; tenant.positions
 * from tenant-service over HTTP or an operator export file — NEVER cross-service
 * SQL) and the current employee rows, PLANS a workforce_core backfill, prints a
 * report (JSON + human summary) and, by default, WRITES NOTHING.
 *
 * Build first (so dist/ exists), then run:
 *   pnpm --filter @civitasone/hrms-service build
 *   node services/hrms-service/scripts/workforce-core-backfill.mjs \
 *     --dry-run --tenant <tenantId> [--positions-file positions.json] \
 *     [--report-dir ./out]
 *
 * APPLY (writes; gated by the flag):
 *   WORKFORCE_CORE_LEDGER_ENABLED=true \
 *   node services/hrms-service/scripts/workforce-core-backfill.mjs \
 *     --apply --tenant <tenantId> [--positions-file positions.json]
 *
 * Env: DATABASE_URL (hrms_svc, NOBYPASSRLS), and for the HTTP positions path
 * TENANT_SERVICE_URL + INTERNAL_SERVICE_SECRET. --positions-file skips HTTP.
 */
import postgres from "postgres";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  runBackfillForTenant,
  renderHumanSummary,
} from "../dist/modules/workforce-core/backfill.js";
import {
  readPositionsFromFile,
  fetchPositionsFromTenantService,
} from "../dist/modules/workforce-core/backfill-positions.js";

function parseArgs(argv) {
  const args = { dryRun: true, apply: false, tenant: null, positionsFile: null, reportDir: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--apply") { args.apply = true; args.dryRun = false; }
    else if (a === "--tenant") args.tenant = argv[++i];
    else if (a === "--positions-file") args.positionsFile = argv[++i];
    else if (a === "--report-dir") args.reportDir = argv[++i];
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
    else { console.error(`unknown argument: ${a}`); process.exit(2); }
  }
  return args;
}

function printHelp() {
  console.log(
    "usage: workforce-core-backfill.mjs --dry-run|--apply --tenant <id>\n" +
      "       [--positions-file <json>] [--report-dir <dir>]\n" +
      "env: DATABASE_URL (required), TENANT_SERVICE_URL + INTERNAL_SERVICE_SECRET (HTTP positions),\n" +
      "     WORKFORCE_CORE_LEDGER_ENABLED=true (required for --apply)",
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.tenant) { console.error("--tenant <tenantId> is required"); process.exit(2); }
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is required"); process.exit(2); }

  // Resolve tenant.positions via the chosen house-rule-compliant path.
  let tenantPositions = [];
  let positionsSource = "none";
  if (args.positionsFile) {
    tenantPositions = await readPositionsFromFile(args.positionsFile);
    positionsSource = `file:${args.positionsFile}`;
  } else if (process.env.TENANT_SERVICE_URL) {
    tenantPositions = await fetchPositionsFromTenantService(args.tenant);
    positionsSource = "http:tenant-service";
  }

  const sql = postgres(url, { max: 1 });
  try {
    const report = await runBackfillForTenant({
      sql,
      tenantId: args.tenant,
      apply: args.apply,
      tenantPositions,
    });
    report.positionsSource = positionsSource;

    const json = JSON.stringify(report, null, 2);
    const human = renderHumanSummary(report);
    console.log(human);
    console.log("\n--- JSON ---\n" + json);

    if (args.reportDir) {
      await mkdir(args.reportDir, { recursive: true });
      const stamp = `${report.tenantId}-${report.mode}`;
      await writeFile(join(args.reportDir, `backfill-${stamp}.json`), json);
      await writeFile(join(args.reportDir, `backfill-${stamp}.txt`), human);
      console.error(`report written to ${args.reportDir}`);
    }

    // Non-zero exit on conflicts so CI/ops can gate on a clean dry run.
    if (report.conflicts.length > 0) process.exitCode = 1;
  } catch (e) {
    console.error("backfill failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
