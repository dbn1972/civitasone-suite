/**
 * Repo layer (tasks / visits / routes / sync) — queries are built against the real
 * drizzle schema and run on a recording fake, so these tests assert result mapping,
 * pagination wiring, optimistic-version outcome and the idempotent-empty paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeTx, NOW, T } from "./support/fake-tx.js";

const H = vi.hoisted(() => ({ results: [] as unknown[], lastOps: [] as unknown[] }));

vi.mock("../src/shared/db.js", async () => {
  const { makeFakeTx: mk } = await import("./support/fake-tx.js");
  return {
    db: {},
    scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => {
      const { tx, ops } = mk(H.results);
      const out = await fn(tx);
      H.lastOps.push(...ops);
      return out;
    },
    sqlClient: { end: async () => {} },
  };
});

const tasks = await import("../src/modules/tasks/repo.js");
const visits = await import("../src/modules/visits/repo.js");
const routes = await import("../src/modules/routes/repo.js");
const sync = await import("../src/modules/sync/repo.js");

const base = { id: "id-1", tenantId: T, createdAt: NOW, updatedAt: NOW, version: 2 };

beforeEach(() => {
  H.results.length = 0;
  H.lastOps.length = 0;
});

describe("tasks/repo", () => {
  const row = {
    ...base, assigneeId: null, taskType: "inspection", title: "t", description: null, status: "unassigned",
    priority: 3, latitude: null, longitude: null, address: null, dueDate: new Date("2026-09-01T00:00:00Z"),
    completedAt: null, cancelledAt: null, metadata: null,
  };

  it("toView serialises dates to ISO and keeps nulls", () => {
    const v = tasks.toView(row as never);
    expect(v.createdAt).toBe(NOW.toISOString());
    expect(v.dueDate).toBe("2026-09-01T00:00:00.000Z");
    expect(v.completedAt).toBeNull();
    expect(v.version).toBe(2);
  });

  it("findById returns the first row or null", async () => {
    H.results.push([row]);
    expect((await tasks.findById("id-1", T))?.id).toBe("id-1");
    H.results.push([]);
    expect(await tasks.findById("missing", T)).toBeNull();
  });

  it("listByTenant applies all filters and returns rows + total", async () => {
    H.results.push([row], [{ count: 7 }]);
    const out = await tasks.listByTenant(T, 10, 20, {
      status: "assigned", assigneeId: "u1", dueBefore: "2026-10-01", dueAfter: "2026-08-01",
    });
    expect(out).toEqual({ rows: [row], total: 7 });
    const sel = H.lastOps[0] as { calls: Array<[string, unknown[]]> };
    expect(sel.calls.find(([k]) => k === "limit")?.[1]).toEqual([10]);
    expect(sel.calls.find(([k]) => k === "offset")?.[1]).toEqual([20]);
  });

  it("listByTenant defaults total to 0 when count row is absent", async () => {
    H.results.push([], []);
    expect(await tasks.listByTenant(T, 5, 0)).toEqual({ rows: [], total: 0 });
  });

  it("insert issues an insert with the row", async () => {
    const { tx, ops } = makeFakeTx([undefined]);
    await tasks.insert(tx as never, row as never);
    expect(ops[0]!.verb).toBe("insert");
    expect(ops[0]!.calls.find(([k]) => k === "values")?.[1]).toEqual([row]);
  });

  it("update reports whether the version-guarded row was matched", async () => {
    const hit = makeFakeTx([[{ id: "id-1" }]]);
    expect(await tasks.update(hit.tx as never, "id-1", T, { title: "x" }, 2)).toBe(true);
    const set = hit.ops[0]!.calls.find(([k]) => k === "set")![1][0] as Record<string, unknown>;
    expect(set.title).toBe("x");
    expect(set.updatedAt).toBeInstanceOf(Date);
    const miss = makeFakeTx([[]]);
    expect(await tasks.update(miss.tx as never, "id-1", T, {}, 1)).toBe(false);
  });

  it("listAgents drops null assignees and maps counts", async () => {
    H.results.push([{ agentId: "a", taskCount: 2 }, { agentId: null, taskCount: 9 }]);
    expect(await tasks.listAgents(T)).toEqual([{ agentId: "a", taskCount: 2 }]);
  });

  it("getKpis maps status counts", async () => {
    H.results.push([{ status: "assigned", count: 3 }]);
    expect(await tasks.getKpis(T)).toEqual([{ status: "assigned", count: 3 }]);
  });
});

describe("visits/repo", () => {
  const row = {
    ...base, taskId: "t1", agentId: "a1", checkInLatitude: "1", checkInLongitude: "2",
    checkOutLatitude: null, checkOutLongitude: null, checkInAt: NOW, checkOutAt: null,
    durationMinutes: null, outcome: null, notes: null, photos: [],
  };

  it("toView maps timestamps and tolerates null check-in/out", () => {
    const v = visits.toView(row as never);
    expect(v.checkInAt).toBe(NOW.toISOString());
    expect(v.checkOutAt).toBeNull();
    expect(visits.toView({ ...row, checkInAt: null } as never).checkInAt).toBeNull();
  });

  it("findById / findByTaskId / findByAgent / listRecent", async () => {
    H.results.push([row]);
    expect((await visits.findById("id-1", T))?.id).toBe("id-1");
    H.results.push([]);
    expect(await visits.findById("nope", T)).toBeNull();

    H.results.push([row], [{ count: 4 }]);
    expect(await visits.findByTaskId("t1", T, 10, 0)).toEqual({ rows: [row], total: 4 });
    H.results.push([row], []);
    expect(await visits.findByAgent("a1", T, 10, 0)).toEqual({ rows: [row], total: 0 });
    H.results.push([row], [{ total: 11 }]);
    expect(await visits.listRecent(T, 10, 0)).toEqual({ rows: [row], total: 11 });
    H.results.push([], []);
    expect(await visits.listRecent(T, 10, 0)).toEqual({ rows: [], total: 0 });
  });

  it("insert + update", async () => {
    const ins = makeFakeTx([undefined]);
    await visits.insert(ins.tx as never, row as never);
    expect(ins.ops[0]!.verb).toBe("insert");
    expect(await visits.update(makeFakeTx([[{ id: "x" }]]).tx as never, "x", T, { notes: "n" }, 1)).toBe(true);
    expect(await visits.update(makeFakeTx([[]]).tx as never, "x", T, {}, 9)).toBe(false);
  });
});

describe("routes/repo", () => {
  const row = {
    ...base, assigneeId: "a1", routeDate: "2026-09-01", status: "optimized", waypoints: [],
    optimizedOrder: [0], totalDistanceKm: "1.5", estimatedDurationMinutes: 12,
  };

  it("toView maps the plan", () => {
    const v = routes.toView(row as never);
    expect(v.routeDate).toBe("2026-09-01");
    expect(v.updatedAt).toBe(NOW.toISOString());
  });

  it("finders and list", async () => {
    H.results.push([row]);
    expect((await routes.findById("id-1", T))?.id).toBe("id-1");
    H.results.push([]);
    expect(await routes.findById("nope", T)).toBeNull();
    H.results.push([row]);
    expect((await routes.findByAssigneeAndDate("a1", "2026-09-01", T))?.id).toBe("id-1");
    H.results.push([]);
    expect(await routes.findByAssigneeAndDate("a1", "2026-09-02", T)).toBeNull();
    H.results.push([row], [{ count: 1 }]);
    expect(await routes.listByTenant(T, 10, 0)).toEqual({ rows: [row], total: 1 });
    H.results.push([], []);
    expect((await routes.listByTenant(T, 10, 0)).total).toBe(0);
  });

  it("insert + update", async () => {
    const ins = makeFakeTx([undefined]);
    await routes.insert(ins.tx as never, row as never);
    expect(ins.ops[0]!.verb).toBe("insert");
    expect(await routes.update(makeFakeTx([[{ id: "x" }]]).tx as never, "x", T, { status: "s" }, 1)).toBe(true);
    expect(await routes.update(makeFakeTx([[]]).tx as never, "x", T, {}, 1)).toBe(false);
  });
});

describe("sync/repo", () => {
  const row = {
    ...base, agentId: "a1", entityType: "task", entityId: "e1", operation: "update", payload: {},
    clientTimestamp: NOW, clientVersion: 1, status: "processed", attempts: 0, lastError: null, processedAt: null,
  };

  it("toView maps optional processedAt", () => {
    expect(sync.toView(row as never).processedAt).toBeNull();
    expect(sync.toView({ ...row, processedAt: NOW } as never).processedAt).toBe(NOW.toISOString());
    expect(sync.toView(row as never).clientTimestamp).toBe(NOW.toISOString());
  });

  it("insertBatch skips empty batches and inserts non-empty ones", async () => {
    const empty = makeFakeTx([]);
    await sync.insertBatch(empty.tx as never, []);
    expect(empty.ops).toHaveLength(0);
    const one = makeFakeTx([undefined]);
    await sync.insertBatch(one.tx as never, [row as never]);
    expect(one.ops[0]!.verb).toBe("insert");
  });

  it("markProcessed reflects whether a row matched; markFailed updates", async () => {
    expect(await sync.markProcessed(makeFakeTx([[{ id: "x" }]]).tx as never, "x", T)).toBe(true);
    expect(await sync.markProcessed(makeFakeTx([[]]).tx as never, "x", T)).toBe(false);
    const f = makeFakeTx([undefined]);
    await sync.markFailed(f.tx as never, "x", T, "boom");
    const set = f.ops[0]!.calls.find(([k]) => k === "set")![1][0] as Record<string, unknown>;
    expect(set.status).toBe("failed");
    expect(set.lastError).toBe("boom");
  });

  it("getChangesSince returns rows and total (0 when count missing)", async () => {
    H.results.push([row], [{ count: 3 }]);
    expect(await sync.getChangesSince(T, "a1", "2026-08-01T00:00:00Z", 50)).toEqual({ rows: [row], total: 3 });
    H.results.push([], []);
    expect((await sync.getChangesSince(T, "a1", "2026-08-01T00:00:00Z", 50)).total).toBe(0);
  });
});
