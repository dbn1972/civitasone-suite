import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "..");

function src(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

describe("F3 P0 finance masters/budget CQRS", () => {
  it("bank/fy routes return 202 and do not write in-route", () => {
    const bank = src("src/modules/masters/bank-routes.ts");
    const fy = src("src/modules/masters/fy-routes.ts");
    expect(bank).toMatch(/code\(202\)/);
    expect(bank).not.toMatch(/db\.transaction/);
    expect(fy).toMatch(/code\(202\)/);
    expect(fy).not.toMatch(/db\.transaction/);
  });

  it("allocation/distribution/formulation mutations are queue-first", () => {
    for (const f of [
      "src/modules/budget/allocation-routes.ts",
      "src/modules/budget/distribution-routes.ts",
      "src/modules/budget/formulation-routes.ts",
    ]) {
      const t = src(f);
      expect(t).toMatch(/queue\.publish/);
      expect(t).toMatch(/code\(202\)/);
      expect(t).not.toMatch(/code\(201\)/);
    }
  });

  it("masters consumer markProcessed for bank/fy commands", () => {
    const c = src("src/modules/masters/consumer.ts");
    expect(c).toMatch(/markProcessed/);
    expect(c).toMatch(/bankAccountCreate|COMMANDS\.bankAccountCreate/);
    expect(c).toMatch(/fiscalYearCreate|COMMANDS\.fiscalYearCreate/);
  });
});
