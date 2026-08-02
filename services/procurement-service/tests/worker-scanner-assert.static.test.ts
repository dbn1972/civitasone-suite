import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("procurement worker scanner fail-closed", () => {
  const src = readFileSync(join(__dirname, "../src/worker.ts"), "utf8");

  it("asserts PROCUREMENT_SCANNER_DATABASE_URL distinct from DATABASE_URL in production", () => {
    expect(src).toContain("assertScannerConfigured");
    expect(src).toContain("PROCUREMENT_SCANNER_DATABASE_URL");
  });

  it("asserts PII_ENC_KEY is configured before subscribing consumers (117-restart-loop regression)", () => {
    expect(src).toContain("assertPiiKeyConfigured");
    const assertIdx = src.indexOf("assertPiiKeyConfigured()");
    const subscribeIdx = src.indexOf("registerIndentConsumers(queue)");
    expect(assertIdx).toBeGreaterThan(-1);
    expect(subscribeIdx).toBeGreaterThan(-1);
    expect(assertIdx).toBeLessThan(subscribeIdx);
  });
});
