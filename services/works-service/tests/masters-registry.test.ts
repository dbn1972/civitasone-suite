/**
 * Masters registry completeness — every registered master has a unique prefix,
 * a createSchema, and a table mapping used by both routes and consumer.
 */
import { describe, it, expect } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { ZodEffects, ZodObject, type ZodRawShape, type ZodTypeAny } from "zod";
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

  // UAT B9-works: zod strips unknown keys and drizzle ignores keys that are not
  // columns, so a body field the table cannot store (code on proposer_types,
  // demandNumber stripped on user_departments, PATCH name on sr_items) was
  // 202-accepted and silently lost. Every create/PATCH schema must be strict
  // and every key it accepts must be a real column of that master's table.
  function objectOf(schema: ZodTypeAny): ZodObject<ZodRawShape> {
    let s: ZodTypeAny = schema;
    while (s instanceof ZodEffects) s = s.innerType();
    expect(s).toBeInstanceOf(ZodObject);
    return s as ZodObject<ZodRawShape>;
  }

  it("every create and PATCH schema key is a column of its table (nothing silently dropped)", () => {
    const drift: string[] = [];
    for (const m of masters) {
      const columns = new Set(Object.keys(getTableColumns(m.table)));
      for (const [kind, schema] of [["create", m.createSchema], ["patch", m.patchSchema]] as const) {
        expect(schema, `${m.prefix} has no ${kind} schema`).toBeDefined();
        for (const key of Object.keys(objectOf(schema).shape)) {
          if (kind === "patch" && key === "version") continue;
          if (!columns.has(key)) drift.push(`${m.prefix} ${kind}: ${key} is not a column of ${getTableName(m.table)}`);
        }
      }
    }
    expect(drift).toEqual([]);
  });

  it("every create and PATCH schema rejects an unknown field (400, not a silent strip)", () => {
    const lenient: string[] = [];
    for (const m of masters) {
      for (const [kind, schema] of [["create", m.createSchema], ["patch", m.patchSchema]] as const) {
        if (objectOf(schema)._def.unknownKeys !== "strict") lenient.push(`${m.prefix} ${kind}`);
      }
    }
    expect(lenient).toEqual([]);
  });

  it("the fields the web form sends for user-departments / contractor-classes are accepted", () => {
    const ud = masters.find((m) => m.prefix === "user-departments")!;
    const cc = masters.find((m) => m.prefix === "contractor-classes")!;
    expect(ud.createSchema.parse({ name: "D", demandNumber: "H-1" })).toEqual({ name: "D", demandNumber: "H-1" });
    expect(cc.createSchema.parse({ name: "A", description: "d" })).toEqual({ name: "A", description: "d" });
    expect(() => ud.createSchema.parse({ name: "D", code: "X" })).toThrow();
  });
});
