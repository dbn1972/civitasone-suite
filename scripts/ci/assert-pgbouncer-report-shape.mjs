#!/usr/bin/env node
// assert-pgbouncer-report-shape.mjs — task 17.3 CI smoke-check helper.
//
// Asserts that scripts/ops/verify-pgbouncer-routing.mjs produced a
// well-formed report (proves the tool ran end-to-end against a live
// pg_stat_activity, not that the fleet is compliant — see the CI step's
// comment in .github/workflows/ci.yml for why compliance itself is asserted
// elsewhere, against the actual pgbouncer-fronted deployments).
//
// Usage: node scripts/ci/assert-pgbouncer-report-shape.mjs <path-to-report.json>
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("assert-pgbouncer-report-shape: missing <path-to-report.json> argument");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(path, "utf8"));
} catch (err) {
  console.error(`assert-pgbouncer-report-shape: could not read/parse ${path} — ${err?.message ?? err}`);
  process.exit(1);
}

const isValid =
  report !== null &&
  typeof report === "object" &&
  Array.isArray(report.services) &&
  Array.isArray(report.nonCompliantServices) &&
  typeof report.overallCompliant === "boolean";

if (!isValid) {
  console.error("assert-pgbouncer-report-shape: verify-pgbouncer-routing.mjs did not produce a valid report");
  process.exit(1);
}

console.log(`assert-pgbouncer-report-shape: OK — ${report.services.length} services reported`);
