#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// evidence-suite-dbs-guard.mjs — PERF-022: scripts/ci/bootstrap-postgres.sh's
// EVIDENCE_SUITE_DBS array must never silently shrink.
//
// THE DEFECT THIS CATCHES
// ------------------------
// PERF-020 fixed civitas_admin's inability to CONNECT to 6 of the 8
// REVOKE-ALL-FROM-PUBLIC-hardened foundational databases (tenant, identity,
// policy, audit, notification, billing — finance and procurement were
// already covered) by adding those 6 service entries to
// scripts/ci/bootstrap-postgres.sh's EVIDENCE_SUITE_DBS array, which drives
// infra/db/bootstrap/grant_admin_readonly.sql's `GRANT CONNECT ON DATABASE
// ... TO civitas_admin` for each entry.
//
// PERF-022 found CI's own gate cannot actually exercise that fix:
// .github/workflows/ci.yml's schema-drift-guard.mjs / tenant-index-guard.mjs
// steps run as POSTGRES_ADMIN_USER=civitas — the bootstrapping SUPERUSER,
// which bypasses `REVOKE ALL FROM PUBLIC` entirely and so can connect
// regardless of whether EVIDENCE_SUITE_DBS lists a database at all. If a
// future change silently drops one of these entries (a bad merge, or
// "cleaning up" what looks like a redundant line), civitas_admin loses
// CONNECT to that database again — exactly PERF-020's bug — and the
// superuser-run guards would stay green throughout.
//
// This guard is the fast, no-database-needed half of PERF-022's fix: pure
// text analysis of bootstrap-postgres.sh's EVIDENCE_SUITE_DBS array,
// asserting every currently-known entry is still present. It cannot verify
// the GRANT actually works end to end against a live cluster — that is what
// the live "civitas_admin reachability" step added to the integration-tests
// job (.github/workflows/ci.yml) is for. This one catches the array
// shrinking at all, in seconds, with no live Postgres — the accidental-
// regression shape PERF-022's own evidence names ("a future accidental
// removal of one of the ... EVIDENCE_SUITE_DBS entries").
//
// CHECK: does bootstrap-postgres.sh's EVIDENCE_SUITE_DBS array still
// contain every entry in REQUIRED_ENTRIES below?
//
// Usage:
//   node scripts/ci/evidence-suite-dbs-guard.mjs
//
// No live database needed — pure text analysis, like tenant-table-rls-guard.mjs
// / nested-tx-guard.mjs — so this runs in the arch-guard job, not the
// Bootstrap Postgres job.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const BOOTSTRAP_SCRIPT = join(REPO_ROOT, "scripts/ci/bootstrap-postgres.sh");

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

// The full EVIDENCE_SUITE_DBS set as of PERF-022 (2026-09-13) — 13 entries.
// 8 of these are the PERF-020-critical ones: the databases
// bootstrap.generated.sql hardens with `REVOKE ALL ON DATABASE ... FROM
// PUBLIC` (tenant, identity, policy, audit, finance, procurement,
// notification, billing). The other 5 (asset, inventory, hrms, payroll,
// contract) are not REVOKE-ALL-hardened, so their entries exist only for
// the cross-service schema-level grant data-quality.test.ts needs, not the
// CONNECT-privilege bug class this guard exists for. Tracked together as
// one list (not split by criticality) because losing ANY entry silently
// narrows civitas_admin's granted access — this guard's job is simply "the
// list must not shrink."
//
// Growing this list (a real new service onboarded onto the same pattern) is
// fine and expected — update it here deliberately when that happens. This
// guard only fails on entries disappearing, never on new ones appearing.
export const REQUIRED_ENTRIES = [
  "asset-service:civitas_asset:asset_svc",
  "inventory-service:civitas_inventory:inventory_svc",
  "hrms-service:civitas_hrms:hrms_svc",
  "payroll-service:civitas_payroll:payroll_svc",
  "procurement-service:civitas_procurement:procurement_svc",
  "contract-service:civitas_contract:contract_svc",
  "finance-service:civitas_finance:finance_svc",
  "tenant-service:civitas_tenant:tenant_svc",
  "identity-service:civitas_identity:identity_svc",
  "policy-service:civitas_policy:policy_svc",
  "audit-service:civitas_audit:audit_svc",
  "notification-service:civitas_notification:notification_svc",
  "billing-service:civitas_billing:billing_svc",
];

// Parses the bash array literal:
//   EVIDENCE_SUITE_DBS=(
//     "asset-service:civitas_asset:asset_svc"
//     ...
//   )
// Comment lines (# ...) and blank lines inside the block are ignored — the
// real file has a multi-line PERF-020 comment interrupting the array partway
// through. Exported for unit testing
// (tests/architecture/evidence-suite-dbs-guard.test.ts).
export function parseEvidenceSuiteDbs(scriptText) {
  const blockMatch = scriptText.match(/EVIDENCE_SUITE_DBS=\(([\s\S]*?)^\)/m);
  if (!blockMatch) {
    throw new Error("Could not find an EVIDENCE_SUITE_DBS=( ... ) array in the script text");
  }
  const body = blockMatch[1];
  const entries = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const stringMatch = line.match(/^"([^"]*)"$/);
    if (stringMatch) entries.push(stringMatch[1]);
  }
  return entries;
}

function main() {
  const scriptText = readFileSync(BOOTSTRAP_SCRIPT, "utf8");
  const current = parseEvidenceSuiteDbs(scriptText);
  const currentSet = new Set(current);
  const missing = REQUIRED_ENTRIES.filter((e) => !currentSet.has(e));

  console.log(
    `${BOLD}evidence-suite-dbs-guard${RESET}: ${current.length} entries currently in EVIDENCE_SUITE_DBS (${REQUIRED_ENTRIES.length} required)`,
  );

  if (missing.length > 0) {
    console.log(
      `${RED}FAIL${RESET} — ${missing.length} required EVIDENCE_SUITE_DBS entr${missing.length === 1 ? "y is" : "ies are"} missing from ${BOOTSTRAP_SCRIPT.slice(REPO_ROOT.length + 1)}:`,
    );
    for (const m of missing) console.log(`  ${RED}${m}${RESET}`);
    console.log(
      "Removing an EVIDENCE_SUITE_DBS entry silently drops civitas_admin's grant\n" +
        "(infra/db/bootstrap/grant_admin_readonly.sql) for that database — for the\n" +
        "8 REVOKE-ALL-hardened foundational databases (see PERF-020), that means\n" +
        "civitas_admin loses CONNECT entirely, reopening PERF-020's bug. Restore\n" +
        "the entry, or if the service is being deliberately retired, update\n" +
        "REQUIRED_ENTRIES in this file's own source with a written reason.",
    );
    process.exit(1);
  }

  console.log(`${GREEN}PASS${RESET} — all ${REQUIRED_ENTRIES.length} required EVIDENCE_SUITE_DBS entries present.`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
