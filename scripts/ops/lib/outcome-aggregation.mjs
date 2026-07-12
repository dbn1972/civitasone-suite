#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// outcome-aggregation.mjs — G10 pass/fail aggregation for backup & restore-drill runs
//
// Pure, deterministic aggregation of per-service outcomes (`success` | `failed`
// | `skipped`) into a single overall pass/fail verdict. Shared by:
//   - scripts/ops/backup-databases.sh   (task 15.3, all 33 databases)
//   - scripts/ops/restore-drill.sh      (task 16.1, Tier-0/Tier-1 databases only)
// so both scripts derive their exit code from the exact same rule instead of
// each re-implementing (and potentially drifting on) the pass/fail logic.
//
// Aggregation rule (Requirements 11.2, 11.4; reused by 12.3, 12.4, 12.6):
//   - The overall run FAILS iff at least one Tier-0/Tier-1 ("critical")
//     service's outcome is `failed`, OR a critical service is entirely absent
//     from the outcomes map (treated as an unreported failure — see "Missing
//     entries" below).
//   - `skipped` NEVER by itself causes an overall failure (Req 11.4 / 12.6:
//     a missing target database, or a service with no backup available in a
//     given environment, is a skip, not a failure).
//   - A failure on a service OUTSIDE the critical universe (e.g. a Tier-2
//     database backup failure) is reported but never fails the overall run by
//     itself (Req 11.2 scopes the non-zero-exit requirement to Tier-0/Tier-1).
//
// Missing entries (a critical service with no entry at all in the outcomes
// map) are deliberately NOT treated the same as an explicit `skipped` outcome.
// `skipped` is a positive assertion by the caller ("I checked, and this
// service intentionally has nothing to do here"); an absent entry means the
// caller never reported an outcome for a service it was supposed to classify.
// Silently treating that as a pass (or as a no-op skip) would let an
// incomplete/crashed run report a false "pass" — which the G10 correctness
// property explicitly forbids ("a corrupted or truncated backup input always
// yields a deterministic `failed` outcome, never a false `passed`"). So a
// missing critical-service entry is aggregated as a failure, listed
// separately (`missingServices`) from explicit failures (`failedServices`)
// for diagnostic clarity.
//
// This module performs no I/O — it is a pure function of its inputs, making
// repeated calls with the same arguments always produce byte-for-byte
// identical results (the determinism property in task 15.2 / Property 8).
// A minimal CLI wrapper is provided for the bash callers, following the same
// "pure exported functions + optional CLI entrypoint" shape used by
// scripts/ops/verify-pgbouncer-routing.mjs.
//
// Usage (from a shell script):
//   echo '{"finance":"success","gateway":"failed"}' | \
//     node scripts/ops/lib/outcome-aggregation.mjs
//   # prints the JSON report to stdout, exits 0 (pass) or 1 (fail)
//
//   node scripts/ops/lib/outcome-aggregation.mjs --file outcomes.json
//   node scripts/ops/lib/outcome-aggregation.mjs --file outcomes.json \
//     --critical finance,estab,hrms
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";

// ── 1. The fixed Tier-0/Tier-1 service universe ──────────────────────────────
// Mirrors docs/operations/SLO-SLI-RUNBOOKS.md §3 ("Per-service SLO table") and
// the runbook set created by task 14.1 (docs/runbooks/{gateway,identity,queue,
// finance,estab,workflow,hrms,payroll,audit}.md).
export const TIER0_SERVICES = ["gateway", "identity", "queue"];
export const TIER1_SERVICES = ["finance", "estab", "workflow", "hrms", "payroll", "audit"];

/** The default "critical" universe used when a caller does not supply its own. */
export const TIER01_SERVICES = [...TIER0_SERVICES, ...TIER1_SERVICES];

// ── 2. Valid outcome vocabulary ──────────────────────────────────────────────
export const OUTCOMES = Object.freeze({
  SUCCESS: "success",
  FAILED: "failed",
  SKIPPED: "skipped",
});

const VALID_OUTCOME_VALUES = new Set(Object.values(OUTCOMES));

export function isValidOutcome(value) {
  return VALID_OUTCOME_VALUES.has(value);
}

// ── 3. Pure aggregation ──────────────────────────────────────────────────────
/**
 * Aggregates per-service backup/restore-drill outcomes into a single overall
 * pass/fail verdict. Pure and deterministic: the same `outcomesByService` and
 * `criticalServices` arguments always produce a structurally identical result
 * (same set membership in every array — see note on ordering below).
 *
 * @param {Record<string, "success" | "failed" | "skipped">} outcomesByService
 *   Map of service name -> outcome. May contain services outside
 *   `criticalServices` (e.g. Tier-2 databases in a full 33-database backup
 *   run) — those are reported but never affect `overall`.
 * @param {string[]} [criticalServices]
 *   The fixed Tier-0/Tier-1 universe whose outcomes determine `overall`.
 *   Defaults to `TIER01_SERVICES`. Callers running a Tier-0/Tier-1-only drill
 *   (task 16.1) may pass a subset; callers running a full 33-database backup
 *   (task 15.3) should pass the same fixed `TIER01_SERVICES` list so that only
 *   critical-service failures affect the exit code, per Requirement 11.2.
 * @returns {{
 *   overall: "pass" | "fail",
 *   criticalServices: string[],
 *   succeededServices: string[],
 *   failedServices: string[],
 *   skippedServices: string[],
 *   missingServices: string[],
 *   nonCriticalFailedServices: string[],
 * }}
 *   - `overall` is `"fail"` iff `failedServices` or `missingServices` is
 *     non-empty; otherwise `"pass"`.
 *   - `succeededServices` / `failedServices` / `skippedServices` /
 *     `missingServices` partition `criticalServices` exactly (every critical
 *     service appears in exactly one of these four arrays).
 *   - `nonCriticalFailedServices` lists services present in
 *     `outcomesByService` with outcome `"failed"` that are NOT in
 *     `criticalServices` — informational only, never affects `overall`.
 *   - Every array is sorted (stable, alphabetical) so the result does not
 *     depend on key-insertion order in `outcomesByService`.
 * @throws {TypeError} if `outcomesByService` is not a plain object/map, if
 *   `criticalServices` is not an array of strings, or if any recorded outcome
 *   is not one of `"success" | "failed" | "skipped"`.
 */
export function aggregateOutcomes(outcomesByService, criticalServices = TIER01_SERVICES) {
  if (outcomesByService === null || typeof outcomesByService !== "object" || Array.isArray(outcomesByService)) {
    throw new TypeError("aggregateOutcomes: outcomesByService must be a plain object mapping service -> outcome");
  }
  if (!Array.isArray(criticalServices) || criticalServices.some((s) => typeof s !== "string" || s.length === 0)) {
    throw new TypeError("aggregateOutcomes: criticalServices must be an array of non-empty service-name strings");
  }

  for (const [service, outcome] of Object.entries(outcomesByService)) {
    if (!isValidOutcome(outcome)) {
      throw new TypeError(
        `aggregateOutcomes: invalid outcome "${outcome}" recorded for service "${service}" ` +
          `(expected one of: ${[...VALID_OUTCOME_VALUES].join(", ")})`,
      );
    }
  }

  const criticalSet = new Set(criticalServices);

  const succeededServices = [];
  const failedServices = [];
  const skippedServices = [];
  const missingServices = [];

  for (const service of criticalSet) {
    const outcome = outcomesByService[service];
    if (outcome === undefined) {
      missingServices.push(service);
    } else if (outcome === OUTCOMES.SUCCESS) {
      succeededServices.push(service);
    } else if (outcome === OUTCOMES.FAILED) {
      failedServices.push(service);
    } else {
      skippedServices.push(service);
    }
  }

  const nonCriticalFailedServices = Object.entries(outcomesByService)
    .filter(([service, outcome]) => outcome === OUTCOMES.FAILED && !criticalSet.has(service))
    .map(([service]) => service);

  const overall = failedServices.length > 0 || missingServices.length > 0 ? "fail" : "pass";

  const sort = (arr) => [...arr].sort((a, b) => a.localeCompare(b));

  return {
    overall,
    criticalServices: sort([...criticalSet]),
    succeededServices: sort(succeededServices),
    failedServices: sort(failedServices),
    skippedServices: sort(skippedServices),
    missingServices: sort(missingServices),
    nonCriticalFailedServices: sort(nonCriticalFailedServices),
  };
}

/**
 * Convenience wrapper: returns the process exit code (`0` pass, `1` fail)
 * that a calling shell script should propagate for a given aggregation
 * result, per Requirement 11.2 ("non-zero exit status if any Tier0/Tier1
 * ... backup fails").
 *
 * @param {ReturnType<typeof aggregateOutcomes>} report
 * @returns {0 | 1}
 */
export function exitCodeFor(report) {
  return report.overall === "pass" ? 0 : 1;
}

// ── 4. Minimal CLI wrapper (for scripts/ops/*.sh callers) ───────────────────
function parseArgs(argv) {
  const opts = { file: null, critical: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--file") {
      opts.file = argv[++i];
    } else if (arg === "--critical") {
      opts.critical = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return opts;
}

function readStdinSync() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const raw = opts.file ? readFileSync(opts.file, "utf8") : readStdinSync();
  if (!raw || !raw.trim()) {
    console.error(
      "outcome-aggregation: no input provided — pass a JSON object of {service: outcome} on stdin or via --file",
    );
    process.exit(2);
  }

  let outcomesByService;
  try {
    outcomesByService = JSON.parse(raw);
  } catch (err) {
    console.error(`outcome-aggregation: failed to parse input JSON — ${err.message}`);
    process.exit(2);
  }

  let report;
  try {
    report = aggregateOutcomes(outcomesByService, opts.critical ?? TIER01_SERVICES);
  } catch (err) {
    console.error(`outcome-aggregation: ${err.message}`);
    process.exit(2);
  }

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exit(exitCodeFor(report));
}

// Only run when executed directly (not when imported by callers/tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`outcome-aggregation: fatal — ${err?.stack || err}`);
    process.exit(2);
  });
}
