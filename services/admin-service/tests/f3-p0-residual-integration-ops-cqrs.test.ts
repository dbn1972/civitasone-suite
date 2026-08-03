import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MOD = join(__dirname, "../src/modules/integration-ops");

describe("F3 P0 residual admin integration-ops CQRS", () => {
  it("dead-letter record route has no sync write / 201", () => {
    const src = readFileSync(join(MOD, "routes.ts"), "utf8");
    expect(src).not.toMatch(/await\s+recordDeadLetter/);
    expect(src).not.toContain("code(201)");
    expect(src).toContain("recordDeadLetterCmd");
    expect(src).toContain("sendAccepted");
  });

  it("consumer markProcessed before upsert", () => {
    const src = readFileSync(join(MOD, "consumer.ts"), "utf8");
    expect(src).toContain("markProcessed");
    expect(src).toContain("upsertDeadLetter");
    expect(src).toContain("deadLetterRecord");
  });
});
