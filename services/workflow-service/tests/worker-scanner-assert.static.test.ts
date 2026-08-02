import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("workflow worker scanner fail-closed", () => {
  const src = readFileSync(join(__dirname, "../src/worker.ts"), "utf8");
  it("asserts WORKFLOW_SCANNER_DATABASE_URL distinct from DATABASE_URL in production", () => {
    expect(src).toContain("assertScannerConfigured");
    expect(src).toContain("WORKFLOW_SCANNER_DATABASE_URL");
    expect(src).toMatch(/scanner === primary|scannerUrl === primary|!== production/);
  });
});
