#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// publish-drill-report.mjs — G10 durable Drill_Report persistence + audit trail
//
// Persists a Restore_Drill's Drill_Report JSON (run timestamp, per-service
// pass/fail outcome, table counts, sample-row verification results — Req 13.1)
// to the `civitasone` object-storage bucket's `dr-drills/` prefix (Req 13.2),
// and submits an Audit_Event recording the drill outcome via the audit-service's
// existing outbox-fed ingestion path (`audit.event.record`, Req 15.3).
//
// Credential-/DSN-shaped fields are stripped via `redactReportPayload()`
// (packages/observability/src/redaction.ts, task 2.1) before persistence.
// Tenant-record-shaped PII surfaced by the drill's sample-row check is
// deliberately left untouched — the report-redaction policy removes
// credentials only, never PII (Req 13.4).
//
// This is a standalone Node ESM CLI script invoked by the Drill_Scheduler
// (.github/workflows/dr-drill.yml, task 16.5) after restore-drill.sh produces
// a Drill_Report artifact. It has no per-request database transaction of its
// own to pair an outbox row with (unlike an in-service consumer), so — like
// other platform-wide, non-tenant-scoped system writes already in the
// codebase (services/billing-service/src/modules/plans/commands.ts,
// services/admin-service/src/modules/config/commands.ts,
// services/court-service/src/modules/public-lookup/routes.ts,
// services/meeting-service/src/workers/tenure-expiry.ts's SYSTEM_ACTOR_ID) —
// it publishes directly to the `audit.event.record` topic using the nil UUID
// as both tenantId and actorId, which audit-service consumes exactly like any
// other outbox-relayed event.
//
// Object storage: uses @civitasone/storage (S3/MinIO adapter, already
// implemented) — respects AWS_S3_BUCKET / AWS_ENDPOINT_URL / AWS_DEFAULT_REGION
// / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_FORCE_PATH_STYLE per its own
// env-var contract (default bucket: "civitasone", matching the design's
// "civitasone bucket" — no hardcoded bucket name here). No new npm dependency
// is introduced: @civitasone/storage and @civitasone/queue are existing
// workspace packages, imported via their compiled `dist/` output using the
// same relative-import pattern already used by tests/integration/*.test.ts
// (e.g. `../../packages/queue/dist/index.js`).
//
// Usage:
//   node scripts/ops/publish-drill-report.mjs drill-report.json
//   cat drill-report.json | node scripts/ops/publish-drill-report.mjs
//   node scripts/ops/publish-drill-report.mjs drill-report.json --json   (machine-readable stdout summary)
//
// Expected Drill_Report JSON shape (produced by restore-drill.sh's --report-json,
// task 16.1/16.5 — accepted here in a tolerant, forward-compatible shape):
//   {
//     "runTimestamp": "2026-07-01T03:00:00.000Z",
//     "results": {
//       "finance": { "outcome": "success", "tableCount": 42, "sampleRowCheck": true },
//       "estab":   "failed"                                    // shorthand also accepted
//     },
//     ... any other fields (e.g. a raw log excerpt) are persisted as-is, minus redaction
//   }
// A `services`/`outcomes` key is also accepted as a synonym for `results`.
//
// Env vars (object storage — see packages/storage/src/index.ts for the full contract):
//   AWS_S3_BUCKET, AWS_ENDPOINT_URL, AWS_DEFAULT_REGION, AWS_ACCESS_KEY_ID,
//   AWS_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE
// Env vars (audit event delivery — see packages/queue/src/index.ts):
//   QUEUE_DRIVER (sqs | rabbitmq | memory), plus the driver's own connection vars
//
// Exit codes:
//   0 — Drill_Report persisted and Audit_Event submitted successfully
//   1 — persistence or Audit_Event submission failed (I/O against a real backend)
//   2 — invalid input (missing/unparseable Drill_Report JSON)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { redactReportPayload } from "../../packages/observability/dist/redaction.js";
import { putObject, bucketName } from "../../packages/storage/dist/index.js";
import { createQueue } from "../../packages/queue/dist/index.js";
import { aggregateOutcomes, TIER01_SERVICES } from "./lib/outcome-aggregation.mjs";

/** The universal audit sink every service's outbox relay publishes to (see docs/runbooks/audit.md). */
const AUDIT_TOPIC = "audit.event.record";

/**
 * Nil-UUID actor/tenant for platform-wide, non-tenant-scoped system writes.
 * Mirrors the SYSTEM_ACTOR_ID convention already used fleet-wide for
 * cross-tenant/system-initiated audit events (e.g.
 * services/meeting-service/src/workers/tenure-expiry.ts,
 * services/billing-service/src/modules/plans/commands.ts,
 * services/court-service/src/modules/public-lookup/routes.ts) — a DR drill
 * run is a platform operation, not scoped to any single tenant.
 */
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

const DR_DRILLS_PREFIX = "dr-drills";

function readStdinSync() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Format an ISO timestamp as a compact, filename-safe token (matches restore-drill.sh's `date -u +%Y%m%dT%H%M%SZ`). */
export function compactTimestamp(iso) {
  const parsed = new Date(iso);
  const source = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return source.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Normalize a Drill_Report's per-service section (`results` / `services` /
 * `outcomes`, each entry either a bare outcome string or an object with an
 * `outcome` field) into a flat `{ service: outcome }` map for aggregation.
 */
export function extractOutcomes(report) {
  const raw = (report && (report.results ?? report.services ?? report.outcomes)) ?? {};
  const outcomes = {};
  for (const [svc, val] of Object.entries(raw)) {
    const outcome = typeof val === "string" ? val : val?.outcome;
    if (typeof outcome === "string") outcomes[svc] = outcome;
  }
  return outcomes;
}

function parseArgs(argv) {
  const opts = { file: null, json: false };
  for (const arg of argv) {
    if (arg === "--json") opts.json = true;
    else if (!arg.startsWith("--")) opts.file = arg;
  }
  return opts;
}

/** Read + parse the Drill_Report JSON from a file path or stdin. Throws with a descriptive message on failure. */
export function loadReport(opts) {
  const raw = opts.file ? readFileSync(opts.file, "utf8") : readStdinSync();
  if (!raw || !raw.trim()) {
    throw new Error("no Drill_Report JSON provided — pass a file path argument or pipe JSON via stdin");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`failed to parse Drill_Report JSON — ${err.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Drill_Report JSON must be a plain object");
  }
  return parsed;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  let report;
  try {
    report = loadReport(opts);
  } catch (err) {
    console.error(`publish-drill-report: ${err.message}`);
    process.exit(2);
    return;
  }

  const runTimestamp = typeof report.runTimestamp === "string" ? report.runTimestamp : new Date().toISOString();
  const outcomesByService = extractOutcomes(report);
  // Scope aggregation to the Tier-0/Tier-1 services this run actually drilled
  // (mirrors restore-drill.sh's own `--critical` scoping) — falling back to
  // the full TIER01_SERVICES universe when the report carries no per-service
  // detail at all, so an empty/legacy-shaped report still produces a verdict
  // rather than throwing.
  const drilledCritical = Object.keys(outcomesByService).filter((s) => TIER01_SERVICES.includes(s));
  const criticalServices = drilledCritical.length > 0 ? drilledCritical : TIER01_SERVICES;

  let aggregation;
  try {
    aggregation = aggregateOutcomes(outcomesByService, criticalServices);
  } catch (err) {
    console.error(`publish-drill-report: could not aggregate report outcomes — ${err.message}`);
    process.exit(2);
    return;
  }

  // Req 13.4: strip credential-/DSN-shaped fields only. Tenant-record PII from
  // the sample-row check is deliberately left untouched by redactReportPayload
  // (report-mode redaction, task 2.1) — the report is persisted regardless of
  // its content (Req 13.2).
  const redactedReport = redactReportPayload({ ...report, runTimestamp, aggregation });

  const objectKey = `${DR_DRILLS_PREFIX}/${compactTimestamp(runTimestamp)}.json`;

  try {
    await putObject(objectKey, JSON.stringify(redactedReport, null, 2), "application/json");
  } catch (err) {
    console.error(`publish-drill-report: failed to persist Drill_Report to object storage — ${err.message}`);
    process.exit(1);
    return;
  }

  const location = `s3://${bucketName()}/${objectKey}`;
  console.log(`publish-drill-report: persisted Drill_Report to ${location}`);

  // Req 15.3: the Drill_Scheduler emits an Audit_Event via the existing
  // outbox-fed ingestion path for every state-changing operation — persisting
  // a Drill_Report is one.
  const outcome = aggregation.overall === "pass" ? "success" : "failed";
  try {
    const queue = createQueue();
    await queue.publish(AUDIT_TOPIC, {
      type: AUDIT_TOPIC,
      tenantId: SYSTEM_ACTOR_ID,
      actorId: SYSTEM_ACTOR_ID,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: {
        service: "ops",
        action: "dr_drill_report",
        resourceType: "drill_report",
        resourceId: objectKey,
        outcome,
        runTimestamp,
        location,
        tier01Summary: aggregation,
      },
    });
    console.log(`publish-drill-report: submitted Audit_Event (outcome=${outcome})`);
  } catch (err) {
    console.error(`publish-drill-report: failed to submit Audit_Event — ${err.message}`);
    process.exit(1);
    return;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ location, outcome, aggregation }, null, 2) + "\n");
  }

  process.exit(0);
}

// Only run when executed directly (not when imported by fixture unit tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`publish-drill-report: fatal — ${err?.stack || err}`);
    process.exit(2);
  });
}
