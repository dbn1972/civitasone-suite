/**
 * Unit tests for `scripts/ci/assert-pgbouncer-report-shape.mjs` (task 17.3 CI
 * wiring helper) — the shape-check the `live-stack-verify` job runs against
 * `verify-pgbouncer-routing.mjs --json`'s output to prove the tool ran
 * end-to-end (queried pg_stat_activity, rendered a report) without asserting
 * fleet compliance itself (the CI's dev-compose stack has no pgbouncer
 * sidecar, so it is expected to be non-compliant there by design).
 *
 * NOTE: lives under tests/architecture/ (not scripts/ci/tests/) because the
 * root vitest.config.mjs only includes "tests/**\/*.test.ts" — mirrors the
 * existing convention for scripts/ci/*.mjs tests (tenant-router-guard.test.ts,
 * runbook-lint.test.ts).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(process.cwd(), "scripts/ci/assert-pgbouncer-report-shape.mjs");

function runWith(json: string): { exitCode: number; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "pgb-report-"));
  const file = join(dir, "report.json");
  writeFileSync(file, json);
  try {
    execFileSync("node", [SCRIPT, file], { stdio: "pipe" });
    return { exitCode: 0, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer };
    return { exitCode: e.status ?? 1, stderr: e.stderr?.toString() ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("assert-pgbouncer-report-shape.mjs", () => {
  it("exits 0 for a well-formed verify-pgbouncer-routing.mjs report", () => {
    const report = JSON.stringify({
      generatedAt: new Date().toISOString(),
      pgbouncerHint: "pgbouncer",
      services: [
        { service: "identity", database: "civitas_identity", envVar: "DATABASE_URL_IDENTITY", connections: 0, viaProxy: 0, direct: 0, compliant: true },
      ],
      nonCompliantServices: [],
      overallCompliant: true,
    });
    expect(runWith(report).exitCode).toBe(0);
  });

  it("exits non-zero for malformed JSON", () => {
    const result = runWith("{ not valid json");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("could not read/parse");
  });

  it("exits non-zero when `services` is missing/not an array", () => {
    const report = JSON.stringify({ overallCompliant: true, nonCompliantServices: [] });
    const result = runWith(report);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("did not produce a valid report");
  });

  it("exits non-zero when `overallCompliant` is not a boolean", () => {
    const report = JSON.stringify({ services: [], nonCompliantServices: [], overallCompliant: "yes" });
    expect(runWith(report).exitCode).not.toBe(0);
  });

  it("exits with code 2 when the report file argument is missing", () => {
    try {
      execFileSync("node", [SCRIPT], { stdio: "pipe" });
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as { status?: number };
      expect(e.status).toBe(2);
    }
  });
});
