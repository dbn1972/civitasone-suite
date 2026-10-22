/**
 * Consumers (tasks / visits / routes / sync) + shared audit/tenant-queue/context.
 * The queue, outbox, cache and repos are faked at the module boundary; the
 * consumers, writeAudit and tenantScoped run for real, so each handler is checked
 * for: write applied, event + audit enqueued, cache invalidated, and the two
 * no-op paths (duplicate message, stale version).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  markProcessed: vi.fn(),
  enqueue: vi.fn(),
  invalidate: vi.fn(),
  makeKey: vi.fn((...p: string[]) => p.join(":")),
  taskRepo: { insert: vi.fn(), update: vi.fn() },
  visitRepo: { insert: vi.fn(), update: vi.fn() },
  routeRepo: { insert: vi.fn(), update: vi.fn() },
  syncRepo: { insertBatch: vi.fn() },
  requirePermission: vi.fn(),
}));

const TX = { __tx: true };
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(TX) },
  scopedRead: async () => [],
  sqlClient: { end: async () => {} },
}));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: H.enqueue, markProcessed: H.markProcessed }));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: H.invalidate, makeKey: H.makeKey },
  queue: {},
}));
vi.mock("../src/modules/tasks/repo.js", () => H.taskRepo);
vi.mock("../src/modules/visits/repo.js", () => H.visitRepo);
vi.mock("../src/modules/routes/repo.js", () => H.routeRepo);
vi.mock("../src/modules/sync/repo.js", () => H.syncRepo);
vi.mock("@civitasone/auth/permissions", () => ({ requirePermission: H.requirePermission }));

import { registerTaskConsumers } from "../src/modules/tasks/consumer.js";
import { registerVisitConsumers } from "../src/modules/visits/consumer.js";
import { registerRouteConsumers } from "../src/modules/routes/consumer.js";
import { registerSyncConsumers } from "../src/modules/sync/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { AUDIT_TOPIC } from "../src/shared/audit.js";
import { HttpError, resolveContext, requireRole, requirePermissionKey } from "../src/shared/context.js";
import { AuthContextError } from "@civitasone/auth/context";

type Handler = (msg: Record<string, unknown>) => Promise<void>;
function fakeQueue() {
  const handlers = new Map<string, Handler>();
  return {
    queue: { subscribe: (topic: string, h: Handler) => void handlers.set(topic, h) } as never,
    run: (topic: string, msg: Record<string, unknown>) => handlers.get(topic)!(msg),
    topics: () => [...handlers.keys()],
  };
}

const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const ACTOR = "aaaaaaaa-1111-4000-8000-000000000001";
const envelope = (payload: Record<string, unknown>) => ({
  messageId: "m-1", tenantId: TENANT, actorId: ACTOR, correlationId: "corr-1", payload,
});

const enqueuedTopics = () => H.enqueue.mock.calls.map((c) => (c[1] as { topic: string }).topic);
const auditCall = () =>
  H.enqueue.mock.calls.map((c) => c[1] as { topic: string; payload: Record<string, unknown>; tenantId: string })
    .find((c) => c.topic === AUDIT_TOPIC)!;

beforeEach(() => {
  vi.clearAllMocks();
  H.markProcessed.mockResolvedValue(true);
  H.taskRepo.update.mockResolvedValue(true);
  H.visitRepo.update.mockResolvedValue(true);
  H.routeRepo.update.mockResolvedValue(true);
});

describe("task consumers", () => {
  const q = fakeQueue();
  registerTaskConsumers(q.queue);

  it("subscribes to every task command", () => {
    expect(q.topics()).toEqual([
      COMMANDS.taskCreate, COMMANDS.taskUpdate, COMMANDS.taskAssign, COMMANDS.taskStart,
      COMMANDS.taskComplete, COMMANDS.taskCancel, COMMANDS.taskDelete,
    ]);
  });

  it("create inserts the row (actor as creator), emits event + audit", async () => {
    await q.run(COMMANDS.taskCreate, envelope({
      id: "t1", assigneeId: null, taskType: "inspection", title: "T", description: null, status: "unassigned",
      priority: 2, latitude: null, longitude: null, address: null, dueDate: "2026-09-01T00:00:00Z", metadata: null,
    }));
    const row = H.taskRepo.insert.mock.calls[0]![1];
    expect(row).toMatchObject({ id: "t1", tenantId: TENANT, createdBy: ACTOR, updatedBy: ACTOR });
    expect(row.dueDate).toEqual(new Date("2026-09-01T00:00:00Z"));
    expect(enqueuedTopics()).toEqual([EVENTS.taskCreated, AUDIT_TOPIC]);
    expect(auditCall().payload).toMatchObject({ action: "task.create", resourceType: "field_task", resourceId: "t1", service: "field" });
  });

  it("create with no due date stores null; duplicate message is a no-op", async () => {
    await q.run(COMMANDS.taskCreate, envelope({ id: "t2", dueDate: null }));
    expect(H.taskRepo.insert.mock.calls[0]![1].dueDate).toBeNull();
    vi.clearAllMocks();
    H.markProcessed.mockResolvedValue(false);
    await q.run(COMMANDS.taskCreate, envelope({ id: "t2", dueDate: null }));
    expect(H.taskRepo.insert).not.toHaveBeenCalled();
    expect(H.enqueue).not.toHaveBeenCalled();
  });

  it("update applies the patch, audits changed fields, invalidates the cache", async () => {
    await q.run(COMMANDS.taskUpdate, envelope({ id: "t1", version: 3, patch: { title: "x", priority: 1 } }));
    expect(H.taskRepo.update).toHaveBeenCalledWith(TX, "t1", TENANT, { title: "x", priority: 1 }, 3);
    expect(auditCall().payload.details).toEqual({ fields: ["title", "priority"] });
    expect(H.invalidate).toHaveBeenCalledWith(`${TENANT}:task:t1`);
  });

  it.each([
    [COMMANDS.taskAssign, EVENTS.taskAssigned, "task.assign", { assigneeId: "u9" }],
    [COMMANDS.taskStart, EVENTS.taskStarted, "task.start", {}],
    [COMMANDS.taskComplete, EVENTS.taskCompleted, "task.complete", {}],
    [COMMANDS.taskCancel, EVENTS.taskCancelled, "task.cancel", {}],
    [COMMANDS.taskDelete, EVENTS.taskDeleted, "task.delete", {}],
  ])("%s emits %s + audit %s and invalidates cache", async (topic, event, action, extra) => {
    await q.run(topic, envelope({ id: "t1", version: 1, ...extra }));
    expect(enqueuedTopics()).toEqual([event, AUDIT_TOPIC]);
    expect(auditCall().payload.action).toBe(action);
    expect(H.invalidate).toHaveBeenCalledTimes(1);
  });

  it("assign sets assignee + status=assigned; complete stamps completedAt; cancel/delete soft-cancel", async () => {
    await q.run(COMMANDS.taskAssign, envelope({ id: "t1", version: 1, assigneeId: "u9" }));
    expect(H.taskRepo.update.mock.calls[0]![3]).toMatchObject({ assigneeId: "u9", status: "assigned", updatedBy: ACTOR });
    await q.run(COMMANDS.taskComplete, envelope({ id: "t1", version: 1 }));
    expect(H.taskRepo.update.mock.calls[1]![3]).toMatchObject({ status: "completed" });
    expect(H.taskRepo.update.mock.calls[1]![3].completedAt).toBeInstanceOf(Date);
    await q.run(COMMANDS.taskStart, envelope({ id: "t1", version: 1 }));
    expect(H.taskRepo.update.mock.calls[2]![3]).toMatchObject({ status: "in_progress" });
    await q.run(COMMANDS.taskDelete, envelope({ id: "t1", version: 1 }));
    expect(H.taskRepo.update.mock.calls[3]![3]).toMatchObject({ status: "cancelled" });
  });

  it.each([
    COMMANDS.taskUpdate, COMMANDS.taskAssign, COMMANDS.taskStart,
    COMMANDS.taskComplete, COMMANDS.taskCancel, COMMANDS.taskDelete,
  ])("%s: stale version => no event, no audit, no cache invalidation", async (topic) => {
    H.taskRepo.update.mockResolvedValue(false);
    await q.run(topic, envelope({ id: "t1", version: 1, patch: {}, assigneeId: "u" }));
    expect(H.enqueue).not.toHaveBeenCalled();
    expect(H.invalidate).not.toHaveBeenCalled();
  });

  it.each([
    COMMANDS.taskUpdate, COMMANDS.taskAssign, COMMANDS.taskStart,
    COMMANDS.taskComplete, COMMANDS.taskCancel, COMMANDS.taskDelete,
  ])("%s: duplicate message => nothing written", async (topic) => {
    H.markProcessed.mockResolvedValue(false);
    await q.run(topic, envelope({ id: "t1", version: 1, patch: {}, assigneeId: "u" }));
    expect(H.taskRepo.update).not.toHaveBeenCalled();
    expect(H.enqueue).not.toHaveBeenCalled();
  });
});

describe("visit consumers", () => {
  const q = fakeQueue();
  registerVisitConsumers(q.queue);

  it("check-in stringifies coordinates and emits event + audit", async () => {
    await q.run(COMMANDS.visitCheckIn, envelope({
      id: "v1", taskId: "t1", latitude: 28.6, longitude: 77.2, checkInAt: "2026-09-01T10:00:00Z",
    }));
    expect(H.visitRepo.insert.mock.calls[0]![1]).toMatchObject({
      id: "v1", agentId: ACTOR, checkInLatitude: "28.6", checkInLongitude: "77.2",
    });
    expect(enqueuedTopics()).toEqual([EVENTS.visitCheckedIn, AUDIT_TOPIC]);
    expect(auditCall().payload.action).toBe("visit.check_in");
  });

  it("check-in duplicate is a no-op", async () => {
    H.markProcessed.mockResolvedValue(false);
    await q.run(COMMANDS.visitCheckIn, envelope({ id: "v1", latitude: 1, longitude: 2, checkInAt: "2026-09-01T10:00:00Z" }));
    expect(H.visitRepo.insert).not.toHaveBeenCalled();
  });

  const out = {
    id: "v1", taskId: "t1", checkOutAt: "2026-09-01T11:00:00Z", latitude: 28.7, longitude: 77.3,
    notes: "ok", photos: ["p.jpg"], durationMinutes: 60, outcome: "completed", version: 1,
  };

  it("check-out records coordinates, duration and outcome", async () => {
    await q.run(COMMANDS.visitCheckOut, envelope(out));
    expect(H.visitRepo.update.mock.calls[0]![3]).toMatchObject({
      checkOutLatitude: "28.7", checkOutLongitude: "77.3", durationMinutes: 60, outcome: "completed", photos: ["p.jpg"],
    });
    expect(enqueuedTopics()).toEqual([EVENTS.visitCheckedOut, AUDIT_TOPIC]);
  });

  it("check-out without GPS stores null coordinates", async () => {
    await q.run(COMMANDS.visitCheckOut, envelope({ ...out, latitude: null, longitude: null }));
    expect(H.visitRepo.update.mock.calls[0]![3]).toMatchObject({ checkOutLatitude: null, checkOutLongitude: null });
  });

  it("check-out stale version / duplicate emit nothing", async () => {
    H.visitRepo.update.mockResolvedValue(false);
    await q.run(COMMANDS.visitCheckOut, envelope(out));
    expect(H.enqueue).not.toHaveBeenCalled();
    H.markProcessed.mockResolvedValue(false);
    await q.run(COMMANDS.visitCheckOut, envelope(out));
    expect(H.visitRepo.update).toHaveBeenCalledTimes(1);
  });
});

describe("route consumers", () => {
  const q = fakeQueue();
  registerRouteConsumers(q.queue);

  it("create persists an optimized plan with the score and emits event + audit", async () => {
    await q.run(COMMANDS.routeCreate, envelope({
      id: "r1", assigneeId: "a1", routeDate: "2026-09-01", waypoints: [{ taskId: "t1" }], optimizedOrder: [0],
      score: { totalDistanceKm: 12.5, estimatedDurationMinutes: 40, priorityCoverage: 1 },
    }));
    expect(H.routeRepo.insert.mock.calls[0]![1]).toMatchObject({
      id: "r1", status: "optimized", totalDistanceKm: "12.5", estimatedDurationMinutes: 40,
    });
    expect(enqueuedTopics()).toEqual([EVENTS.routeCreated, AUDIT_TOPIC]);
  });

  it("create duplicate is a no-op", async () => {
    H.markProcessed.mockResolvedValue(false);
    await q.run(COMMANDS.routeCreate, envelope({ id: "r1", score: { totalDistanceKm: 1, estimatedDurationMinutes: 1 } }));
    expect(H.routeRepo.insert).not.toHaveBeenCalled();
  });

  it("reorder applies, audits and invalidates the route cache key", async () => {
    await q.run(COMMANDS.routeReorder, envelope({ id: "r1", optimizedOrder: [1, 0], version: 2 }));
    expect(H.routeRepo.update).toHaveBeenCalledWith(TX, "r1", TENANT, { optimizedOrder: [1, 0], updatedBy: ACTOR }, 2);
    expect(enqueuedTopics()).toEqual([EVENTS.routeReordered, AUDIT_TOPIC]);
    expect(H.invalidate).toHaveBeenCalledWith(`${TENANT}:route:r1`);
  });

  it("reorder stale version / duplicate do nothing", async () => {
    H.routeRepo.update.mockResolvedValue(false);
    await q.run(COMMANDS.routeReorder, envelope({ id: "r1", optimizedOrder: [0], version: 1 }));
    expect(H.enqueue).not.toHaveBeenCalled();
    expect(H.invalidate).not.toHaveBeenCalled();
    H.markProcessed.mockResolvedValue(false);
    await q.run(COMMANDS.routeReorder, envelope({ id: "r1", optimizedOrder: [0], version: 1 }));
    expect(H.routeRepo.update).toHaveBeenCalledTimes(1);
  });
});

describe("sync consumer", () => {
  const q = fakeQueue();
  registerSyncConsumers(q.queue);
  const ops = [
    { id: "o1", entityType: "task", entityId: "e1", operation: "update", payload: { a: 1 }, clientTimestamp: "2026-09-01T09:00:00Z", clientVersion: 2 },
    { id: "o2", entityType: "visit", entityId: "e2", operation: "create", payload: {}, clientTimestamp: "2026-09-01T09:05:00Z", clientVersion: 1 },
  ];

  it("inserts pending rows for the pushing agent and emits sync.completed + audit", async () => {
    await q.run(COMMANDS.syncPush, envelope({ id: "b1", operations: ops }));
    const rows = H.syncRepo.insertBatch.mock.calls[0]![1];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "o1", tenantId: TENANT, agentId: ACTOR, status: "pending", clientVersion: 2 });
    expect(rows[0].clientTimestamp).toEqual(new Date("2026-09-01T09:00:00Z"));
    expect(enqueuedTopics()).toEqual([EVENTS.syncCompleted, AUDIT_TOPIC]);
    expect(H.enqueue.mock.calls[0]![1].payload).toMatchObject({ operationCount: 2, batchId: "b1" });
    expect(auditCall().payload.details).toEqual({ operationCount: 2 });
  });

  it("duplicate batch is a no-op", async () => {
    H.markProcessed.mockResolvedValue(false);
    await q.run(COMMANDS.syncPush, envelope({ id: "b1", operations: ops }));
    expect(H.syncRepo.insertBatch).not.toHaveBeenCalled();
  });
});

describe("shared/context", () => {
  it("resolveContext maps an unauthenticated request to a 401 HttpError", () => {
    let caught: unknown;
    try { resolveContext({ headers: {} } as never); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(401);
  });

  it("requireRole throws 403 HttpError when no role matches", () => {
    const ctx = { roles: ["viewer"] } as never;
    expect(() => requireRole(ctx, ["admin"])).toThrow(HttpError);
    try { requireRole(ctx, ["admin"]); } catch (e) {
      expect((e as HttpError).status).toBe(403);
      expect((e as HttpError).code).toBe("FORBIDDEN");
    }
    expect(() => requireRole({ roles: ["admin"] } as never, ["admin"])).not.toThrow();
  });

  it("requirePermissionKey passes through, maps AuthContextError, rethrows others", async () => {
    H.requirePermission.mockResolvedValueOnce(undefined);
    await expect(requirePermissionKey({} as never, "field.task.read")).resolves.toBeUndefined();
    H.requirePermission.mockRejectedValueOnce(new AuthContextError(403, "NO_PERM", "denied"));
    await expect(requirePermissionKey({} as never, "k")).rejects.toMatchObject({ status: 403, code: "NO_PERM" });
    const boom = new Error("db down");
    H.requirePermission.mockRejectedValueOnce(boom);
    await expect(requirePermissionKey({} as never, "k")).rejects.toBe(boom);
  });
});

describe("shared/tenant-queue", () => {
  it("passes non-subscribe members through, bound to the target queue", async () => {
    const { tenantScoped } = await import("../src/shared/tenant-queue.js");
    const target = { name: "q", ping() { return (this as { name: string }).name; }, subscribe: vi.fn() };
    const wrapped = tenantScoped(target as never) as unknown as typeof target;
    expect(wrapped.name).toBe("q");
    expect(wrapped.ping()).toBe("q");
    wrapped.subscribe("t", async () => {});
    expect(target.subscribe).toHaveBeenCalledWith("t", expect.any(Function));
  });
});
