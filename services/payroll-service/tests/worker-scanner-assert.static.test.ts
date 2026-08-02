/**
 * Static regression: payroll-worker must fail closed in production when
 * PAYROLL_SCANNER_DATABASE_URL is unset or identical to DATABASE_URL — the
 * outbox relay/purge would otherwise silently run under the tenant-scoped
 * NOBYPASSRLS payroll_svc role and see zero cross-tenant rows. Mirrors
 * works-service / court-service / visitor-service
 * worker-scanner-assert.static.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("payroll worker scanner fail-closed", () => {
  const src = readFileSync(join(__dirname, "../src/worker.ts"), "utf8");

  it("asserts PAYROLL_SCANNER_DATABASE_URL distinct from DATABASE_URL in production", () => {
    expect(src).toContain("assertScannerConfigured");
    expect(src).toContain("PAYROLL_SCANNER_DATABASE_URL");
    expect(src).toMatch(/scanner === primary|scannerUrl === primary/);
    expect(src).toMatch(/!== ["']production["']/);
  });

  it("calls assertScannerConfigured() before wiring the relay/purge", () => {
    const assertIdx = src.indexOf("assertScannerConfigured();");
    const relayIdx = src.indexOf("startRelay(");
    expect(assertIdx).toBeGreaterThan(-1);
    expect(relayIdx).toBeGreaterThan(-1);
    expect(assertIdx).toBeLessThan(relayIdx);
  });
});
