/**
 * Masters registry completeness — every registered master has a unique prefix,
 * a createSchema, and a table mapping used by both routes and consumer.
 */
import { describe, it, expect } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { ZodObject, ZodRawShape } from "zod";
import { masters, masterTableByPrefix, masterMoneyFieldsByPrefix } from "../src/modules/masters/registry.js";

describe("masters registry", () => {
  it("registers exactly 18 master types (matches all-routes masterPrefixes)", () => {
    expect(masters).toHaveLength(18);
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
      "issue-description-types": { name: "Desc", issueTypeId: "00000000-1111-4000-8000-000000000001" },
      assets: { code: "AST", name: "Bridge" },
      "work-description-types": { keyword: "Desc Type", workTypeId: "00000000-1111-4000-8000-000000000001" },
      "sr-items": {
        zone: "N", srYear: "2026", itemCode: "IT-1", description: "Excavation", unit: "cum", rate: "4500000",
      },
      // GAP-WORKS-REPORTS-01: works division master (name/code + optional office type).
      divisions: { name: "Nagpur PWD Division", code: "NGP-PWD" },
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

  // UAT F75/F76: issue-description-types and work-description-types were wired
  // to the generic {name, code, active} schema, which stripped the NOT NULL
  // parent id (and, for work-description-types, the keyword), so the consumer
  // insert could never succeed. Guard the whole registry: every NOT NULL column
  // without a DB default (other than id/tenant_id, which the consumer sets)
  // must be a REQUIRED key of that master's create schema.
  it("every create schema requires each NOT NULL, no-default column of its table", () => {
    const drift: string[] = [];
    for (const m of masters) {
      const shape = (m.createSchema as ZodObject<ZodRawShape>).shape;
      for (const [key, col] of Object.entries(getTableColumns(m.table))) {
        if (key === "id" || key === "tenantId") continue;
        if (!col.notNull || col.hasDefault) continue;
        const field = shape[key];
        if (!field || field.isOptional()) drift.push(`${m.prefix}: ${getTableName(m.table)}.${col.name}`);
      }
    }
    expect(drift).toEqual([]);
  });
});
