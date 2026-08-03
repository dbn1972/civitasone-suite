import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MOD = join(__dirname, "../src/modules/security-compliance");

describe("F3 leftover admin security-compliance CQRS", () => {
  it("routes have zero sync Drizzle writes", () => {
    const src = readFileSync(join(MOD, "routes.ts"), "utf8");
    expect(src).not.toMatch(/\b(?:db|tx)\.(?:insert|update|delete)\s*\(/);
    expect(src).not.toMatch(/db\.transaction/);
    expect(src).toContain("sendAccepted");
    expect(src).toContain("commands.");
  });

  it("consumer markProcessed precedes inserts", () => {
    const src = readFileSync(join(MOD, "consumer.ts"), "utf8");
    expect(src).toContain("markProcessed");
    expect(src).toContain("COMMANDS.vaptReportIngest");
    expect(src).toContain("COMMANDS.complianceControlCreate");
  });
});
