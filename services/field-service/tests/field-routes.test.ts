/**
 * Field service route-level tests — tasks, visits, routes, sync.
 * CQRS: mutations return 202 Accepted and publish a command to the queue;
 * the consumer (not exercised here) applies the write.
 * Happy paths + 400/401/403/404/409/422.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const USER2 = "aaaaaaaa-2222-4000-8000-000000000002";
const TASK_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const VISIT_ID = "cccccccc-1111-4000-8000-000000000001";
const ROUTE_ID = "dddddddd-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  publishMock: vi.fn(),
  scopedReadMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  taskFindByIdMock: vi.fn(),
  taskListMock: vi.fn(),
  visitFindByIdMock: vi.fn(),
  visitFindByTaskMock: vi.fn(),
  visitFindByAgentMock: vi.fn(),
  routeFindByIdMock: vi.fn(),
  routeFindByAssigneeMock: vi.fn(),
  routeListMock: vi.fn(),
  syncGetChangesMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (...a: unknown[]) => H.cacheMakeKeyMock(...a),
  },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));

vi.mock("../src/modules/tasks/repo.js", () => ({
  findById: (...a: unknown[]) => H.taskFindByIdMock(...a),
  listByTenant: (...a: unknown[]) => H.taskListMock(...a),
  insert: vi.fn(),
  update: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/visits/repo.js", () => ({
  findById: (...a: unknown[]) => H.visitFindByIdMock(...a),
  findByTaskId: (...a: unknown[]) => H.visitFindByTaskMock(...a),
  findByAgent: (...a: unknown[]) => H.visitFindByAgentMock(...a),
  insert: vi.fn(),
  update: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/routes/repo.js", () => ({
  findById: (...a: unknown[]) => H.routeFindByIdMock(...a),
  findByAssigneeAndDate: (...a: unknown[]) => H.routeFindByAssigneeMock(...a),
  listByTenant: (...a: unknown[]) => H.routeListMock(...a),
  insert: vi.fn(),
  update: vi.fn(),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/sync/repo.js", () => ({
  insertBatch: vi.fn(),
  getChangesSince: (...a: unknown[]) => H.syncGetChangesMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["field_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["field_admin"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID, tenantId: TENANT, assigneeId: USER,
    taskType: "inspection", title: "Inspect site A",
    description: "Check building foundation",
    status: "assigned", priority: 2,
    latitude: "28.6139000", longitude: "77.2090000",
    address: "New Delhi", dueDate: new Date("2025-06-01"),
    completedAt: null, cancelledAt: null, metadata: null,
    createdAt: new Date(), updatedAt: new Date(),
    createdBy: USER, updatedBy: USER, version: 1,
    ...overrides,
  };
}

function makeVisit(overrides: Record<string, unknown> = {}) {
  return {
    id: VISIT_ID, tenantId: TENANT, taskId: TASK_ID, agentId: USER,
    checkInLatitude: "28.6139000", checkInLongitude: "77.2090000",
    checkOutLatitude: null, checkOutLongitude: null,
    checkInAt: new Date("2025-01-01T10:00:00Z"), checkOutAt: null,
    durationMinutes: null, outcome: null, notes: null, photos: [],
    createdAt: new Date(), updatedAt: new Date(),
    createdBy: USER, updatedBy: USER, version: 1,
    ...overrides,
  };
}

function makeRoute(overrides: Record<string, unknown> = {}) {
  return {
    id: ROUTE_ID, tenantId: TENANT, assigneeId: USER,
    routeDate: "2025-01-15", status: "optimized",
    waypoints: [
      { taskId: TASK_ID, latitude: 28.6, longitude: 77.2, priority: 1 },
      { taskId: "t2", latitude: 28.7, longitude: 77.3, priority: 2 },
    ],
    optimizedOrder: [0, 1],
    totalDistanceKm: "15.50", estimatedDurationMinutes: 61,
    createdAt: new Date(), updatedAt: new Date(),
    createdBy: USER, updatedBy: USER, version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.cacheMakeKeyMock.mockReturnValue("cache-key");
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.publishMock.mockResolvedValue(undefined);
});

// ── TASKS ROUTES ──────────────────────────────────────────────────────────────

describe("POST /v1/field/tasks (create)", () => {
  it("202 — accepts task creation", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/field/tasks",
      headers: auth(),
      payload: { taskType: "inspection", title: "Inspect Site", priority: 2 },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(r.json().id).toBeDefined();
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("field.task.create");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/field/tasks",
      payload: { taskType: "inspection", title: "Test" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/field/tasks",
      headers: auth(USER, ["viewer"]),
      payload: { taskType: "inspection", title: "Test" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("400 — missing required fields", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/field/tasks",
      headers: auth(),
      payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /v1/field/tasks (list)", () => {
  it("200 — returns paginated list", async () => {
    H.taskListMock.mockResolvedValue({ rows: [makeTask()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/field/tasks?limit=10&offset=0",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta.total).toBe(1);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/field/tasks" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /v1/field/tasks/:id (get single)", () => {
  it("200 — returns task", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(makeTask());
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/field/tasks/${TASK_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.id).toBe(TASK_ID);
    await app.close();
  });

  it("404 — not found", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/field/tasks/${TASK_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("PATCH /v1/field/tasks/:id", () => {
  it("202 — accepts task update", async () => {
    H.taskFindByIdMock.mockResolvedValue(makeTask());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/field/tasks/${TASK_ID}`,
      headers: auth(),
      payload: { title: "Updated title", version: 1 },
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("404 — task not found", async () => {
    H.taskFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/field/tasks/${TASK_ID}`,
      headers: auth(),
      payload: { title: "X", version: 1 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — version conflict", async () => {
    H.taskFindByIdMock.mockResolvedValue(makeTask({ version: 2 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/field/tasks/${TASK_ID}`,
      headers: auth(),
      payload: { title: "X", version: 1 },
    });
    expect(r.statusCode).toBe(409);
    expect(H.publishMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("POST /v1/field/tasks/:id/assign", () => {
  it("202 — accepts task assignment", async () => {
    H.taskFindByIdMock.mockResolvedValue(makeTask({ status: "unassigned", assigneeId: null }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/field/tasks/${TASK_ID}/assign`,
      headers: auth(),
      payload: { assigneeId: USER2, version: 1 },
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("field.task.assign");
    await app.close();
  });

  it("404 — task not found", async () => {
    H.taskFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/field/tasks/${TASK_ID}/assign`,
      headers: auth(),
      payload: { assigneeId: USER2, version: 1 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — invalid assignment (completed)", async () => {
    H.taskFindByIdMock.mockResolvedValue(makeTask({ status: "completed" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/field/tasks/${TASK_ID}/assign`,
      headers: auth(),
      payload: { assigneeId: USER2, version: 1 },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("409 — version conflict", async () => {
    H.taskFindByIdMock.mockResolvedValue(makeTask({ status: "unassigned", assigneeId: null, version: 2 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/field/tasks/${TASK_ID}/assign`,
      headers: auth(),
      payload: { assigneeId: USER2, version: 1 },
    });
    expect(r.statusCode).toBe(409);
    expect(H.publishMock).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("POST /v1/field/tasks/:id/start", () => {
  it("202 — accepts task start", async () => {
    H.taskFindByIdMock.mockResolvedValue(makeTask({ status: "assigned" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/field/tasks/${TASK_ID}/start`,
      headers: auth(),
      payload: { version: 1 },
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("422 — invalid transition from unassigned", async () => {
    H.taskFindByIdMock.mockResolvedValue(makeTask({ status: "unassigned" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/field/tasks/${TASK_ID}/start`,
      headers: auth(),
      payload: { version: 1 },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });
});

describe("POST /v1/field/tasks/:id/complete", () => {
  it("202 — accepts task completion", async () => {
    H.taskFindByIdMock.mockResolvedValue(makeTask({ status: "in_progress" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/field/tasks/${TASK_ID}/complete`,
      headers: auth(),
      payload: { version: 1 },
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("422 — invalid transition from assigned", async () => {
    H.taskFindByIdMock.mockResolvedValue(makeTask({ status: "assigned" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/field/tasks/${TASK_ID}/complete`,
      headers: auth(),
      payload: { version: 1 },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });
});

describe("POST /v1/field/tasks/:id/cancel", () => {
  it("202 — accepts task cancellation", async () => {
    H.taskFindByIdMock.mockResolvedValue(makeTask({ status: "in_progress" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/field/tasks/${TASK_ID}/cancel`,
      headers: auth(),
      payload: { version: 1 },
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    await app.close();
  });
});

describe("DELETE /v1/field/tasks/:id", () => {
  it("202 — accepts task delete", async () => {
    H.taskFindByIdMock.mockResolvedValue(makeTask({ status: "assigned" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/field/tasks/${TASK_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("field.task.delete");
    await app.close();
  });

  it("404 — task not found", async () => {
    H.taskFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/field/tasks/${TASK_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — already completed", async () => {
    H.taskFindByIdMock.mockResolvedValue(makeTask({ status: "completed" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE", url: `/v1/field/tasks/${TASK_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });
});

// ── VISITS ROUTES ─────────────────────────────────────────────────────────────

describe("POST /v1/field/visits/check-in", () => {
  it("202 — accepts check-in", async () => {
    H.taskFindByIdMock.mockResolvedValue(makeTask());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/field/visits/check-in",
      headers: auth(),
      payload: { taskId: TASK_ID, latitude: 28.6139, longitude: 77.209 },
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("field.visit.check_in");
    await app.close();
  });

  it("404 — task not found", async () => {
    H.taskFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/field/visits/check-in",
      headers: auth(),
      payload: { taskId: TASK_ID, latitude: 28.6139, longitude: 77.209 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — missing location", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/field/visits/check-in",
      headers: auth(),
      payload: { taskId: TASK_ID },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/field/visits/check-in",
      payload: { taskId: TASK_ID, latitude: 28.6, longitude: 77.2 },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /v1/field/visits/:id/check-out", () => {
  it("202 — accepts check-out", async () => {
    H.visitFindByIdMock.mockResolvedValue(makeVisit());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/field/visits/${VISIT_ID}/check-out`,
      headers: auth(),
      payload: { latitude: 28.614, longitude: 77.21, notes: "All good" },
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("field.visit.check_out");
    await app.close();
  });

  it("404 — visit not found", async () => {
    H.visitFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/field/visits/${VISIT_ID}/check-out`,
      headers: auth(),
      payload: {},
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — no check-in recorded", async () => {
    H.visitFindByIdMock.mockResolvedValue(makeVisit({ checkInAt: null }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/field/visits/${VISIT_ID}/check-out`,
      headers: auth(),
      payload: {},
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });
});

describe("GET /v1/field/visits/by-task/:taskId", () => {
  it("200 — returns visits for task", async () => {
    H.visitFindByTaskMock.mockResolvedValue({ rows: [makeVisit()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/field/visits/by-task/${TASK_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });
});

describe("GET /v1/field/visits/by-agent/:agentId", () => {
  it("200 — returns visits for agent", async () => {
    H.visitFindByAgentMock.mockResolvedValue({ rows: [makeVisit()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/field/visits/by-agent/${USER}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });
});

// ── ROUTES ROUTES ─────────────────────────────────────────────────────────────

describe("POST /v1/field/routes (generate)", () => {
  it("202 — accepts optimized route creation", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/field/routes",
      headers: auth(),
      payload: {
        assigneeId: USER,
        date: "2025-01-15",
        waypoints: [
          { taskId: TASK_ID, latitude: 28.6, longitude: 77.2, priority: 1 },
          { taskId: "eeeeeeee-1111-4000-8000-000000000001", latitude: 28.7, longitude: 77.3, priority: 2 },
        ],
      },
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("field.route.create");
    await app.close();
  });

  it("400 — fewer than 2 waypoints", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/field/routes",
      headers: auth(),
      payload: {
        assigneeId: USER,
        date: "2025-01-15",
        waypoints: [{ taskId: TASK_ID, latitude: 28.6, longitude: 77.2 }],
      },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("403 — agent role cannot generate routes", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/field/routes",
      headers: auth(USER, ["field_agent"]),
      payload: {
        assigneeId: USER,
        date: "2025-01-15",
        waypoints: [
          { taskId: TASK_ID, latitude: 28.6, longitude: 77.2 },
          { taskId: "eeeeeeee-1111-4000-8000-000000000001", latitude: 28.7, longitude: 77.3 },
        ],
      },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/field/routes/by-agent", () => {
  it("200 — returns route for agent and date", async () => {
    H.routeFindByAssigneeMock.mockResolvedValue(makeRoute());
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/field/routes/by-agent?assigneeId=${USER}&date=2025-01-15`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.id).toBe(ROUTE_ID);
    await app.close();
  });

  it("404 — no route found", async () => {
    H.routeFindByAssigneeMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/field/routes/by-agent?assigneeId=${USER}&date=2025-01-15`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("GET /v1/field/routes/today", () => {
  it("200 — returns today's route or null", async () => {
    H.routeFindByAssigneeMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/field/routes/today",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeNull();
    await app.close();
  });
});

describe("PATCH /v1/field/routes/:id/reorder", () => {
  it("202 — accepts waypoint reorder", async () => {
    H.routeFindByIdMock.mockResolvedValue(makeRoute());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/field/routes/${ROUTE_ID}/reorder`,
      headers: auth(),
      payload: { optimizedOrder: [1, 0], version: 1 },
    });
    expect(r.statusCode).toBe(202);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("field.route.reorder");
    await app.close();
  });

  it("404 — route not found", async () => {
    H.routeFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/field/routes/${ROUTE_ID}/reorder`,
      headers: auth(),
      payload: { optimizedOrder: [1, 0], version: 1 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — invalid order length", async () => {
    H.routeFindByIdMock.mockResolvedValue(makeRoute());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/field/routes/${ROUTE_ID}/reorder`,
      headers: auth(),
      payload: { optimizedOrder: [0], version: 1 },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("409 — version conflict", async () => {
    H.routeFindByIdMock.mockResolvedValue(makeRoute({ version: 2 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/field/routes/${ROUTE_ID}/reorder`,
      headers: auth(),
      payload: { optimizedOrder: [1, 0], version: 1 },
    });
    expect(r.statusCode).toBe(409);
    expect(H.publishMock).not.toHaveBeenCalled();
    await app.close();
  });
});

// ── SYNC ROUTES ───────────────────────────────────────────────────────────────

describe("POST /v1/field/sync/push", () => {
  it("202 — processes batch", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/field/sync/push",
      headers: auth(),
      payload: {
        operations: [
          {
            entityType: "task",
            entityId: TASK_ID,
            operation: "update",
            payload: { status: "completed" },
            clientTimestamp: "2025-01-01T10:00:00Z",
            clientVersion: 1,
          },
        ],
      },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.processed).toBe(1);
    expect(H.publishMock).toHaveBeenCalledOnce();
    const [topic] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe("field.sync.push");
    await app.close();
  });

  it("422 — invalid entity type", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/field/sync/push",
      headers: auth(),
      payload: {
        operations: [
          {
            entityType: "invalid",
            entityId: TASK_ID,
            operation: "update",
            payload: {},
            clientTimestamp: "2025-01-01T10:00:00Z",
          },
        ],
      },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/field/sync/push",
      payload: { operations: [] },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("GET /v1/field/sync/pull", () => {
  it("200 — returns changes since timestamp", async () => {
    H.syncGetChangesMock.mockResolvedValue({ rows: [], total: 0 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/field/sync/pull?since=2025-01-01T00:00:00Z",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]);
    expect(r.json().meta.total).toBe(0);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/field/sync/pull?since=2025-01-01T00:00:00Z",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
