import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MOD = join(__dirname, "../src/modules");

describe("F3 P0 leftover CRM CQRS", () => {
  it("quotations/roles/teams routes have zero sync writes", () => {
    for (const rel of ["deals/quotations-routes.ts", "contacts/roles-routes.ts", "teams/routes.ts"]) {
      const src = readFileSync(join(MOD, rel), "utf8");
      expect(src).not.toMatch(/await\s+db\.transaction/);
      expect(src).not.toContain("code(201)");
    }
  });

  it("publish helpers and consumers exist", () => {
    expect(readFileSync(join(MOD, "deals/quotation-commands.ts"), "utf8")).toContain("createQuotation");
    expect(readFileSync(join(MOD, "deals/quotation-consumer.ts"), "utf8")).toContain("markProcessed");
    expect(readFileSync(join(MOD, "contacts/roles-consumer.ts"), "utf8")).toContain("markProcessed");
    expect(readFileSync(join(MOD, "teams/consumer.ts"), "utf8")).toContain("markProcessed");
  });
});
