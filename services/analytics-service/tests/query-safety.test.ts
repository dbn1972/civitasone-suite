/**
 * QUERY-SAFETY GUARANTEE TESTS.
 *
 * analytics runs user-defined queries. These tests are the first-class proof
 * that a user can NEVER inject raw SQL and can NEVER drop the tenant predicate.
 * They inspect the COMPILED SQL + bound params (no DB connection needed) so the
 * guarantee is verified structurally, not by hoping a runtime check fires.
 */
import { describe, it, expect } from "vitest";
import { db } from "../src/shared/db.js";
import { buildAggregateQuery } from "../src/modules/registry/builder.js";
import { querySpecSchema } from "../src/modules/registry/spec.js";
import { RegistryError } from "../src/modules/registry/registry.js";

const TENANT = "11111111-aaaa-4000-8000-000000000001";
const INJECTION = "x'; DROP TABLE analytics.fact_events; --";

describe("query builder — SQL injection is impossible", () => {
  it("binds a malicious filter value as a parameter, never inline SQL", () => {
    const spec = querySpecSchema.parse({
      metric: "amount_sum",
      dimensions: ["source"],
      filters: [{ field: "status", op: "eq", value: INJECTION }],
    });
    const { sql, params } = buildAggregateQuery(db, TENANT, spec).toSQL();

    // The dangerous string is a bound param, NOT concatenated into the SQL text.
    expect(params).toContain(INJECTION);
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain(INJECTION);
    // Values are placeholders.
    expect(sql).toMatch(/\$\d+/);
  });

  it("always includes a bound tenant predicate that the spec cannot remove", () => {
    const spec = querySpecSchema.parse({ metric: "event_count", dimensions: [], filters: [] });
    const { sql, params } = buildAggregateQuery(db, TENANT, spec).toSQL();
    expect(sql).toContain("tenant_id");
    expect(params).toContain(TENANT);
  });

  it("only references whitelisted physical columns (no user-supplied identifiers)", () => {
    const spec = querySpecSchema.parse({
      metric: "amount_avg",
      dimensions: ["source", "status"],
      filters: [{ field: "amount", op: "gt", value: 100 }],
    });
    const { sql } = buildAggregateQuery(db, TENANT, spec).toSQL();
    // every identifier in the query maps to a real fact_events column
    expect(sql).toContain("fact_events");
    expect(sql).toContain('"source"');
    expect(sql).toContain('"status"');
  });

  it("parameterises every value in an IN list", () => {
    const spec = querySpecSchema.parse({
      metric: "event_count",
      dimensions: [],
      filters: [{ field: "source", op: "in", value: ["finance", "grants", INJECTION] }],
    });
    const { sql, params } = buildAggregateQuery(db, TENANT, spec).toSQL();
    expect(params).toContain(INJECTION);
    expect(sql).not.toContain(INJECTION);
  });
});

describe("registry — non-whitelisted identifiers are rejected", () => {
  it("rejects an unknown metric at the builder (defence in depth past zod)", () => {
    // bypass zod to prove the builder itself refuses unknown identifiers
    const badSpec = { metric: "secret_dump", dimensions: [], filters: [], limit: 100 } as never;
    expect(() => buildAggregateQuery(db, TENANT, badSpec)).toThrow(RegistryError);
  });

  it("rejects an unknown dimension at the builder", () => {
    const badSpec = { metric: "event_count", dimensions: ["password"], filters: [], limit: 100 } as never;
    expect(() => buildAggregateQuery(db, TENANT, badSpec)).toThrow(RegistryError);
  });

  it("rejects an unknown filter field at the builder", () => {
    const badSpec = {
      metric: "event_count",
      dimensions: [],
      filters: [{ field: "pg_class", op: "eq", value: "x" }],
      limit: 100,
    } as never;
    expect(() => buildAggregateQuery(db, TENANT, badSpec)).toThrow(RegistryError);
  });

  // Regression: resolveMetric/resolveDimension/resolveFilterField used to do
  // `const def = MAP[key]; if (!def) throw ...` — for a plain object literal,
  // MAP["__proto__"] resolves (via the prototype chain) to the real, truthy
  // Object.prototype instead of undefined, so the "unknown identifier" guard
  // never fired. Same for "constructor", "toString", etc. Now guarded with
  // Object.prototype.hasOwnProperty before the index access.
  it("rejects '__proto__' as a metric key (prototype-chain lookup bypass)", () => {
    const badSpec = { metric: "__proto__", dimensions: [], filters: [], limit: 100 } as never;
    expect(() => buildAggregateQuery(db, TENANT, badSpec)).toThrow(RegistryError);
  });

  it("rejects 'constructor' as a dimension key (prototype-chain lookup bypass)", () => {
    const badSpec = { metric: "event_count", dimensions: ["constructor"], filters: [], limit: 100 } as never;
    expect(() => buildAggregateQuery(db, TENANT, badSpec)).toThrow(RegistryError);
  });

  it("rejects '__proto__' as a filter field (prototype-chain lookup bypass)", () => {
    const badSpec = {
      metric: "event_count",
      dimensions: [],
      filters: [{ field: "__proto__", op: "eq", value: "x" }],
      limit: 100,
    } as never;
    expect(() => buildAggregateQuery(db, TENANT, badSpec)).toThrow(RegistryError);
  });
});

describe("spec validation — the API surface accepts no raw SQL", () => {
  it("rejects unknown metric keys", () => {
    expect(() => querySpecSchema.parse({ metric: "drop_everything" })).toThrow();
  });

  it("rejects unknown dimensions", () => {
    expect(() => querySpecSchema.parse({ metric: "event_count", dimensions: ["ssn"] })).toThrow();
  });

  it("rejects unknown filter operators", () => {
    expect(() =>
      querySpecSchema.parse({ metric: "event_count", filters: [{ field: "status", op: "like", value: "%" }] }),
    ).toThrow();
  });

  it("rejects unknown/extra properties (no smuggled `sql` field)", () => {
    expect(() =>
      querySpecSchema.parse({ metric: "event_count", sql: "SELECT * FROM users" } as never),
    ).toThrow();
  });

  it("accepts a well-formed spec and applies safe defaults", () => {
    const spec = querySpecSchema.parse({ metric: "amount_sum", dimensions: ["source"] });
    expect(spec.filters).toEqual([]);
    expect(spec.limit).toBe(100);
  });
});
