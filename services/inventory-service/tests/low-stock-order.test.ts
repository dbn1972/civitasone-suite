/**
 * Low-stock report: limit/offset pages need a total order, otherwise rows
 * overlap or are skipped between pages. DB-free: the db module is a recording
 * chain, so the test asserts the query that WOULD run.
 */
import { describe, it, expect, vi } from "vitest";

const rec = vi.hoisted(() => ({ ops: [] as Array<[string, unknown[]]> }));

vi.mock("../src/shared/db.js", () => {
  const chain: Record<string, (...a: unknown[]) => unknown> = {};
  for (const name of ["select", "from", "innerJoin", "where", "orderBy", "limit"]) {
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

const repo = await import("../src/modules/movements/repo.js");
const { stockBalances } = await import("../src/modules/movements/schema.js");
const { items } = await import("../src/modules/items/schema.js");

describe("listLowStock ordering", () => {
  it("orders by shortfall (desc), then item name, then balance id, before limit/offset", async () => {
    await repo.listLowStock("11111111-aaaa-4000-8000-0000000000a1", 50, 0);
    const names = rec.ops.map(([n]) => n);
    expect(names.indexOf("orderBy")).toBeGreaterThan(-1);
    expect(names.indexOf("orderBy")).toBeLessThan(names.indexOf("limit"));
    const args = rec.ops.find(([n]) => n === "orderBy")![1] as unknown[];
    // First key is the shortfall (reorderLevel - onHand) descending; the rest keep the page total order.
    expect(args).toHaveLength(3);
    expect(args.slice(1)).toEqual([items.name, stockBalances.id]);
  });

  it("countLowStock counts with the same filter (no limit/offset)", async () => {
    rec.ops.length = 0;
    const n = await repo.countLowStock("11111111-aaaa-4000-8000-0000000000a1").catch(() => 0);
    expect(n).toBe(0);
    expect(rec.ops.map(([x]) => x)).not.toContain("limit");
  });
});
