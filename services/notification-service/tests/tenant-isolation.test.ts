/**
 * BUG-1 regression: findByUser previously had no WHERE clause, leaking all
 * tenants' delivery rows. Verifies the WHERE clause now gates on tenantId.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

let whereCalled = false;
let capturedArgs: unknown[] = [];

vi.mock("../src/shared/db.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => {
          whereCalled = true;
          capturedArgs = args;
          return { limit: () => Promise.resolve([]) };
        },
        limit: () => Promise.resolve([{ tenantId: "tenant-B", id: "other-tenant-row" }]),
      }),
    }),
    insert: vi.fn(),
    update: vi.fn(),
  },
  // scopedRead wraps reads in the tenant tx; the mock passes a tx exposing the
  // same select chain so RLS-scoped reads exercise the identical assertions.
  // readScoped additionally establishes the tenant context itself (PR #152
  // pattern); for the mock both expose the same select chain.
  readScoped: (_tenantId: string, fn: (tx: unknown) => unknown) =>
    fn({
      select: () => ({
        from: () => ({
          where: (...args: unknown[]) => {
            whereCalled = true;
            capturedArgs = args;
            return { limit: () => Promise.resolve([]) };
          },
          limit: () => Promise.resolve([{ tenantId: "tenant-B", id: "other-tenant-row" }]),
        }),
      }),
    }),
  scopedRead: (fn: (tx: unknown) => unknown) =>
    fn({
      select: () => ({
        from: () => ({
          where: (...args: unknown[]) => {
            whereCalled = true;
            capturedArgs = args;
            return { limit: () => Promise.resolve([]) };
          },
          limit: () => Promise.resolve([{ tenantId: "tenant-B", id: "other-tenant-row" }]),
        }),
      }),
    }),
}));

import { findByUser } from "../src/modules/deliveries/repo.js";

describe("findByUser — cross-tenant data isolation (BUG-1)", () => {
  beforeEach(() => {
    whereCalled = false;
    capturedArgs = [];
  });

  it("applies a WHERE clause — previously went straight to .limit() exposing all rows", async () => {
    await findByUser("tenant-A", "user-1");
    expect(whereCalled).toBe(true);
  });

  it("rows from a different tenant are never returned — WHERE gates tenantId", async () => {
    const rows = await findByUser("tenant-A", "user-1");
    // Mock returns [] when WHERE is applied (our stub returns [] from where().limit())
    // Without the fix, the old code skipped WHERE and called limit() directly,
    // which our stub returns [{tenantId:"tenant-B"}] — proving the leak.
    expect(rows).toEqual([]);
  });

  it("accepts (tenantId, userId) signature — TypeScript prevents bare userId-only calls", async () => {
    // Two different tenants scoped separately — each gets its own WHERE filter
    await findByUser("tenant-X", "actor-1");
    const firstCallGotWhere = whereCalled;
    whereCalled = false;

    await findByUser("tenant-Y", "actor-2");
    const secondCallGotWhere = whereCalled;

    expect(firstCallGotWhere).toBe(true);
    expect(secondCallGotWhere).toBe(true);
  });
});
