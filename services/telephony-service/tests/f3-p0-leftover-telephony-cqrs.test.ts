import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const IVR = join(__dirname, "../src/modules/ivr");

describe("F3 P0 leftover telephony IVR CQRS", () => {
  it("ivr routes have no sync insertBatch", () => {
    const src = readFileSync(join(IVR, "routes.ts"), "utf8");
    expect(src).not.toContain("insertBatch");
    expect(src).not.toContain("tenantTransaction");
    expect(src).toContain("code(202)");
    expect(src).toContain("commands.batchIvrHits");
  });

  it("consumer markProcessed precedes insertBatch", () => {
    const src = readFileSync(join(IVR, "consumer.ts"), "utf8");
    expect(src.indexOf("markProcessed")).toBeLessThan(src.indexOf("insertBatch"));
  });
});
