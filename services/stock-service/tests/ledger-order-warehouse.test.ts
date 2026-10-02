/**
 * GAP-INVENTORY-RECONCILE-05 / -04: the stock ledger read is ordered (so a full
 * page is the newest N movements, not an arbitrary subset) and the
 * `warehouseId` filter the route validates is actually applied.
 *
 * DB-free: the db module is replaced by a recording chain, so the test asserts
 * the query that WOULD run.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const rec = vi.hoisted(() => ({ ops: [] as Array<[string, unknown[]]> }));

vi.mock("@civitasone/db", () => ({
  runWithTenant: <T>(_tenant: string, fn: () => T): T => fn(),
}));
vi.mock("../src/shared/db.js", () => {
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const name of ["select", "from", "where", "orderBy", "limit"]) {
    chain[name] = (...args: unknown[]) => {
      rec.ops.push([name, args]);
      return chain;
    };
  }
  chain.offset = (...args: unknown[]) => {
    rec.ops.push(["offset", args]);
    return Promise.resolve([]);
  };
  return { db: {}, scopedRead: <T>(fn: (tx: unknown) => Promise<T>) => fn(chain) };
});

const repo = await import("../src/modules/entry/repo.js");
const { stockLedger } = await import("../src/modules/ledger/schema.js");

const TENANT = "11111111-aaaa-4000-8000-0000000000a1";
const WAREHOUSE = "22222222-aaaa-4000-8000-0000000000b2";
const dialect = new PgDialect();

beforeEach(() => {
  rec.ops.length = 0;
});

describe("findLedger ordering", () => {
  it("orders by posting date desc, created desc, id, BEFORE limit/offset", async () => {
    await repo.findLedger(TENANT, null, { limit: 500, offset: 0 });
    const names = rec.ops.map(([n]) => n);
    expect(names.indexOf("orderBy")).toBeGreaterThan(-1);
    expect(names.indexOf("orderBy")).toBeLessThan(names.indexOf("limit"));
    const args = rec.ops.find(([n]) => n === "orderBy")![1];
    expect(args).toHaveLength(3);
    expect(args[2]).toBe(stockLedger.id);
    const rendered = args.slice(0, 2).map((a) => dialect.sqlToQuery(a as SQL).sql);
    expect(rendered[0]).toMatch(/posting_date.*desc/);
    expect(rendered[1]).toMatch(/created_at.*desc/);
  });
});

describe("findLedger warehouse filter", () => {
  it("adds a warehouse_id condition when given", async () => {
    await repo.findLedger(TENANT, null, { warehouseId: WAREHOUSE });
    const where = rec.ops.find(([n]) => n === "where")![1][0] as SQL;
    const q = dialect.sqlToQuery(where);
    expect(q.sql).toContain("warehouse_id");
    expect(q.params).toContain(WAREHOUSE);
  });

  it("does not filter by warehouse when absent", async () => {
    await repo.findLedger(TENANT, null, {});
    const where = rec.ops.find(([n]) => n === "where")![1][0] as SQL;
    expect(dialect.sqlToQuery(where).sql).not.toContain("warehouse_id");
  });
});
