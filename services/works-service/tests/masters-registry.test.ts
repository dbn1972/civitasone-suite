/**
 * Masters registry completeness — every registered master has a unique prefix,
 * a createSchema, and a table mapping used by both routes and consumer.
 */
import { describe, it, expect } from "vitest";
import { masters, masterTableByPrefix, masterMoneyFieldsByPrefix } from "../src/modules/masters/registry.js";

describe("masters registry", () => {
  it("registers exactly 17 master types (matches all-routes masterPrefixes)", () => {
    expect(masters).toHaveLength(17);
  });

  it("every master has a unique prefix", () => {
    const prefixes = masters.map((m) => m.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("masterTableByPrefix maps every registered prefix to its table", () => {
    for (const m of masters) {
      expect(masterTableByPrefix[m.prefix]).toBe(m.table);
    }
  });

  it("moneyFields are declared only for assets (cost) and sr-items (rate)", () => {
    expect(masterMoneyFieldsByPrefix["assets"]).toEqual(["cost"]);
    expect(masterMoneyFieldsByPrefix["sr-items"]).toEqual(["rate"]);
    for (const m of masters) {
      if (m.prefix !== "assets" && m.prefix !== "sr-items") {
        expect(masterMoneyFieldsByPrefix[m.prefix] ?? []).toEqual([]);
      }
    }
  });

  it("every master createSchema accepts a minimal valid payload", () => {
    const samples: Record<string, unknown> = {
      authorities: { name: "Auth", code: "A1" },
      "work-types": { name: "Type", code: "WT" },
      "work-sub-types": { name: "Sub", code: "ST", workTypeId: "00000000-1111-4000-8000-000000000001" },
      "proposer-types": { name: "Proposer" },
      programs: { name: "Program" },
      "publication-levels": { name: "Level" },
      "repair-types": { name: "Repair", programId: "00000000-1111-4000-8000-000000000001" },
      schemes: { name: "Scheme" },
      scopes: { name: "Scope", workTypeId: "00000000-1111-4000-8000-000000000001", unit: "km" },
      "tender-types": { name: "Tender" },
      "user-departments": { name: "Dept" },
      "contractor-classes": { name: "Class A" },
      "issue-types": { name: "Issue" },
      "issue-description-types": { name: "Desc" },
      assets: { code: "AST", name: "Bridge" },
      "work-description-types": { name: "Desc Type" },
      "sr-items": {
        zone: "N", srYear: "2026", itemCode: "IT-1", description: "Excavation", unit: "cum", rate: "4500000",
      },
    };

    for (const m of masters) {
      const sample = samples[m.prefix];
      expect(sample, `missing sample for ${m.prefix}`).toBeDefined();
      expect(() => m.createSchema.parse(sample)).not.toThrow();
    }
  });

  it("rejects an untrusted master prefix (not in registry)", () => {
    expect(masterTableByPrefix["not-a-real-master"]).toBeUndefined();
  });
});
