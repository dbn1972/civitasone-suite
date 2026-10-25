/**
 * Q17: task start / complete and visit check-in are limited to the assigned
 * agent or a field supervisor (field_admin / super_admin). Any other agent gets
 * 403 and the refusal is audited; nothing is published.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const ASSIGNED = "aaaaaaaa-1111-4000-8000-000000000001";
const OTHER = "aaaaaaaa-2222-4000-8000-000000000002";
const ADMIN = "aaaaaaaa-3333-4000-8000-000000000003";
const TASK_ID = "bbbbbbbb-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  taskFind: vi.fn(),
  publish: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
  scopedRead: async () => [],
  sqlClient: { end: async () => {} },
}));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: (...a: unknown[]) => H.enqueue(...a) }));
vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), makeKey: () => "k" },
  queue: { publish: (...a: unknown[]) => H.publish(...a) },
}));
vi.mock("../src/modules/tasks/repo.js", () => ({
  listAgents: vi.fn(async () => []), getKpis: vi.fn(async () => []),
  findById: (...a: unknown[]) => H.taskFind(...a),
  listByTenant: vi.fn(), insert: vi.fn(), update: vi.fn(), toView: (r: Record<string, unknown>) => r,
}));
vi.mock("../src/modules/visits/repo.js", () => ({
  listRecent: vi.fn(), findById: vi.fn(), findByTaskId: vi.fn(), findByAgent: vi.fn(),
  insert: vi.fn(), update: vi.fn(), toView: (r: Record<string, unknown>) => r,
}));
vi.mock("../src/modules/routes/repo.js", () => ({
  findById: vi.fn(), findByAssigneeAndDate: vi.fn(), listByTenant: vi.fn(),
  insert: vi.fn(), update: vi.fn(), toView: (r: Record<string, unknown>) => r,
}));
vi.mock("../src/modules/sync/repo.js", () => ({
  insertBatch: vi.fn(), getChangesSince: vi.fn(), toView: (r: Record<string, unknown>) => r,
}));

import { buildApp } from "../src/app.js";

const auth = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});
const task = (o: Record<string, unknown> = {}) => ({
  id: TASK_ID, tenantId: TENANT, assigneeId: ASSIGNED, status: "assigned", version: 1, ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.publish.mockResolvedValue(undefined);
  H.taskFind.mockResolvedValue(task());
});

const CASES: Array<[string, string, Record<string, unknown>, string]> = [
  ["start", `/v1/field/tasks/${TASK_ID}/start`, { version: 1 }, "assigned"],
  ["complete", `/v1/field/tasks/${TASK_ID}/complete`, { version: 1 }, "in_progress"],
  ["check-in", "/v1/field/visits/check-in", { taskId: TASK_ID, latitude: 28.6, longitude: 77.2 }, "assigned"],
];

describe.each(CASES)("%s", (name, url, payload, status) => {
  it("403 for a different field_agent, audited as denied, nothing published", async () => {
    H.taskFind.mockResolvedValue(task({ status }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(OTHER, ["field_agent"]), payload });
    expect(r.statusCode).toBe(403);
    expect(H.publish).not.toHaveBeenCalled();
    expect(H.enqueue).toHaveBeenCalledOnce();
    expect(H.enqueue.mock.calls[0]![1]).toMatchObject({
      topic: "audit.event.record",
      actorId: OTHER,
      payload: { action: `field.task.${name}.denied`, outcome: "denied", resourceId: TASK_ID },
    });
    await app.close();
  });

  it("403 for an agent on a task nobody is assigned to", async () => {
    H.taskFind.mockResolvedValue(task({ status, assigneeId: null }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(OTHER, ["field_agent"]), payload });
    expect(r.statusCode).toBe(403);
    expect(H.publish).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 for the assigned agent", async () => {
    H.taskFind.mockResolvedValue(task({ status }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(ASSIGNED, ["field_agent"]), payload });
    expect(r.statusCode).toBe(202);
    expect(H.publish).toHaveBeenCalledOnce();
    await app.close();
  });

  it.each(["field_admin", "super_admin"])("202 for %s regardless of assignment", async (role) => {
    H.taskFind.mockResolvedValue(task({ status }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(ADMIN, [role]), payload });
    expect(r.statusCode).toBe(202);
    expect(H.publish).toHaveBeenCalledOnce();
    await app.close();
  });
});
