import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MOD = join(__dirname, "../src/modules/verification");

describe("F3 P0 residual asset verification CQRS", () => {
  it("routes/commands have zero sync db.transaction and no 201", () => {
    for (const rel of ["routes.ts", "commands.ts"]) {
      const src = readFileSync(join(MOD, rel), "utf8");
      expect(src).not.toMatch(/await\s+db\.transaction/);
      expect(src).not.toContain("code(201)");
    }
  });

  it("consumer registers markProcessed writers", () => {
    const src = readFileSync(join(MOD, "consumer.ts"), "utf8");
    expect(src).toContain("markProcessed");
    expect(src).toContain("verificationCreate");
    expect(src).toContain("writeoffApprove");
  });
});
