/**
 * Unit tests for `publish-drill-report.mjs` (task 16.4).
 *
 * Exercises the script's pure, side-effect-free exports directly (loadReport,
 * extractOutcomes, compactTimestamp) plus the exact redaction composition the
 * script applies before persistence (`redactReportPayload({ ...report,
 * runTimestamp, aggregation })`), without touching real object storage or the
 * queue — no S3/MinIO/SQS/RabbitMQ required.
 *
 * Validates: Requirement 13.4 (credential-shaped fields never persisted;
 * tenant-record-shaped PII from the sample-row check persisted unchanged).
 */
import { describe, it, expect } from "vitest";
import {
  loadReport,
  extractOutcomes,
  compactTimestamp,
} from "../../scripts/ops/publish-drill-report.mjs";
import { redactReportPayload } from "../../packages/observability/dist/redaction.js";
import { aggregateOutcomes, TIER01_SERVICES } from "../../scripts/ops/lib/outcome-aggregation.mjs";

describe("publish-drill-report.mjs — loadReport", () => {
  it("parses a valid JSON object passed via the --file path", () => {
    const report = loadReport({ file: writeTempJson({ runTimestamp: "2026-07-01T03:00:00.000Z", results: {} }) });
    expect(report.runTimestamp).toBe("2026-07-01T03:00:00.000Z");
  });

  it("rejects a report that is not a plain object (array)", () => {
    expect(() => loadReport({ file: writeTempJson([1, 2, 3]) })).toThrow(/plain object/);
  });

  it("rejects unparseable JSON with a descriptive error", () => {
    expect(() => loadReport({ file: writeTempRaw("not json{{{") })).toThrow(/failed to parse/);
  });
});

describe("publish-drill-report.mjs — extractOutcomes", () => {
  it("accepts the shorthand bare-string outcome form", () => {
    const outcomes = extractOutcomes({ results: { finance: "success", estab: "failed" } });
    expect(outcomes).toEqual({ finance: "success", estab: "failed" });
  });

  it("accepts the object form with an `outcome` field", () => {
    const outcomes = extractOutcomes({
      results: { finance: { outcome: "success", tableCount: 42, sampleRowCheck: true } },
    });
    expect(outcomes).toEqual({ finance: "success" });
  });

  it("accepts `services` and `outcomes` as synonyms for `results`", () => {
    expect(extractOutcomes({ services: { hrms: "success" } })).toEqual({ hrms: "success" });
    expect(extractOutcomes({ outcomes: { hrms: "failed" } })).toEqual({ hrms: "failed" });
  });

  it("returns an empty map for a report with no per-service section at all", () => {
    expect(extractOutcomes({})).toEqual({});
    expect(extractOutcomes(null)).toEqual({});
  });

  it("silently skips entries whose value has neither a string form nor an `outcome` field", () => {
    const outcomes = extractOutcomes({ results: { finance: "success", broken: { note: "no outcome key" } } });
    expect(outcomes).toEqual({ finance: "success" });
  });
});

describe("publish-drill-report.mjs — compactTimestamp", () => {
  it("matches restore-drill.sh's `date -u +%Y%m%dT%H%M%SZ` format", () => {
    expect(compactTimestamp("2026-07-01T03:04:05.678Z")).toBe("20260701T030405Z");
  });

  it("falls back to the current time for an unparseable timestamp, still producing a well-formed token", () => {
    const token = compactTimestamp("not-a-date");
    expect(token).toMatch(/^\d{8}T\d{6}Z$/);
  });
});

describe("publish-drill-report.mjs — redaction composition (Req 13.4)", () => {
  it("a report with injected credential-/DSN-shaped fields never persists them", () => {
    const report = {
      runTimestamp: "2026-07-01T03:00:00.000Z",
      results: { finance: "success" },
      // Injected credential-shaped fields, as if a leaky log excerpt were embedded.
      dsn: "postgres://civitas_admin:S3cr3tPassw0rd@db.internal:5432/civitas_finance",
      password: "S3cr3tPassw0rd",
      restoreLogExcerpt: "connection string: postgres://user:hunter2@host/db",
    };
    const outcomesByService = extractOutcomes(report);
    const aggregation = aggregateOutcomes(outcomesByService, TIER01_SERVICES);
    const redacted = redactReportPayload({ ...report, runTimestamp: report.runTimestamp, aggregation });

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("S3cr3tPassw0rd");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toMatch(/postgres:\/\/[^"]*:[^"@]*@/);
  });

  it("tenant-record-shaped PII surfaced by the sample-row check is persisted unchanged", () => {
    const report = {
      runTimestamp: "2026-07-01T03:00:00.000Z",
      results: {
        finance: {
          outcome: "success",
          tableCount: 42,
          sampleRowCheck: true,
          sampleRow: { email: "citizen@example.gov.in", name: "Ram Kumar", aadhaar: "123456789012" },
        },
      },
    };
    const outcomesByService = extractOutcomes(report);
    const aggregation = aggregateOutcomes(outcomesByService, TIER01_SERVICES);
    const redacted = redactReportPayload({ ...report, runTimestamp: report.runTimestamp, aggregation });

    // Report-mode redaction strips credentials only — sample-row PII surfaced
    // by the drill's own verification step must survive untouched (Req 13.4).
    expect(redacted.results.finance.sampleRow.email).toBe("citizen@example.gov.in");
    expect(redacted.results.finance.sampleRow.name).toBe("Ram Kumar");
  });

  it("always preserves a non-empty correlationId-equivalent identity: the report's runTimestamp survives redaction", () => {
    const report = { runTimestamp: "2026-07-01T03:00:00.000Z", results: { finance: "success" } };
    const outcomesByService = extractOutcomes(report);
    const aggregation = aggregateOutcomes(outcomesByService, TIER01_SERVICES);
    const redacted = redactReportPayload({ ...report, runTimestamp: report.runTimestamp, aggregation });
    expect(redacted.runTimestamp).toBe("2026-07-01T03:00:00.000Z");
  });
});

// ── test helpers ──────────────────────────────────────────────────────────────
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function writeTempJson(value: unknown): string {
  return writeTempRaw(JSON.stringify(value));
}

function writeTempRaw(raw: string): string {
  const dir = mkdtempSync(join(tmpdir(), "drill-report-fixture-"));
  const path = join(dir, "report.json");
  writeFileSync(path, raw);
  return path;
}
