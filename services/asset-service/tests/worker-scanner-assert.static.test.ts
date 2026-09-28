/**
 * Static regression: asset-service's worker.ts must fail closed in
 * production when ASSET_SCANNER_DATABASE_URL is missing or equals
 * DATABASE_URL, instead of silently letting the depreciation scheduler's
 * cross-tenant scan fall back to the NOBYPASSRLS connection (which returns
 * zero rows under FORCE RLS -- the exact bug this migration fixes). Mirrors
 * visitor-service's tests/worker-scanner-assert.static.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("asset worker scanner fail-closed", () => {
  const src = readFileSync(join(__dirname, "../src/worker.ts"), "utf8");

  it("asserts ASSET_SCANNER_DATABASE_URL distinct from DATABASE_URL in production", () => {
    expect(src).toContain("assertScannerConfigured");
    expect(src).toContain("ASSET_SCANNER_DATABASE_URL");
  });

  it("calls assertScannerConfigured() at module load, not just defines it", () => {
    expect(src).toMatch(/^assertScannerConfigured\(\);\s*$/m);
  });
});
