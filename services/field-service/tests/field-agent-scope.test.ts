/**
 * Privacy scoping: a plain field_agent only ever sees their OWN tasks, visits
 * (GPS check-ins) and routes; field_admin / super_admin keep tenant-wide reads.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const AGENT = "aaaaaaaa-1111-4000-8000-000000000001";
const OTHER = "aaaaaaaa-2222-4000-8000-000000000002";
const ID = "bbbbbbbb-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  taskList: vi.fn(), taskFind: vi.fn(),
  visitList: vi.fn(), visitFind: vi.fn(), visitByTask: vi.fn(), visitByAgent: vi.fn(),
  routeList: vi.fn(), routeFind: vi.fn(), routeByAssignee: vi.fn(),
  getOrLoad: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
  scopedRead: async () => [],
  sqlClient: { end: async () => {} },
}));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn() }));
vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: (...a: unknown[]) => H.getOrLoad(...a), invalidate: vi.fn(), makeKey: () => "k" },
  queue: { publish: vi.fn() },
}));
vi.mock("../src/modules/tasks/repo.js", () => ({
  listAgents: vi.fn(async () => []), getKpis: vi.fn(async () => []),
  findById: (...a: unknown[]) => H.taskFind(...a),
  listByTenant: (...a: unknown[]) => H.taskList(...a),
  insert: vi.fn(), update: vi.fn(), toView: (r: Record<string, unknown>) => r,
}));
vi.mock("../src/modules/visits/repo.js", () => ({
  listRecent: (...a: unknown[]) => H.visitList(...a),
  findById: (...a: unknown[]) => H.visitFind(...a),
  findByTaskId: (...a: unknown[]) => H.visitByTask(...a),
  findByAgent: (...a: unknown[]) => H.visitByAgent(...a),
  insert: vi.fn(), update: vi.fn(), toView: (r: Record<string, unknown>) => r,
}));
vi.mock("../src/modules/routes/repo.js", () => ({
  findById: (...a: unknown[]) => H.routeFind(...a),
  findByAssigneeAndDate: (...a: unknown[]) => H.routeByAssignee(...a),
  listByTenant: (...a: unknown[]) => H.routeList(...a),
  insert: vi.fn(), update: vi.fn(), toView: (r: Record<string, unknown>) => r,
}));
vi.mock("../src/modules/sync/repo.js", () => ({
  insertBatch: vi.fn(), getChangesSince: vi.fn(), toView: (r: Record<string, unknown>) => r,
}));

import { buildApp } from "../src/app.js";
import * as taskRepo from "../src/modules/tasks/repo.js";

const auth = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});
const page = { rows: [], total: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  H.taskList.mockResolvedValue(page);
  H.visitList.mockResolvedValue(page);
  H.visitByTask.mockResolvedValue(page);
  H.visitByAgent.mockResolvedValue(page);
  H.routeList.mockResolvedValue(page);
  H.getOrLoad.mockImplementation(async (_k: string, loader: () => Promise<unknown>) => loader());
});

describe("field_agent scoping", () => {
  it("GET /tasks forces assigneeId to the caller, ignoring a client-supplied one", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/field/tasks?assigneeId=${OTHER}`, headers: auth(AGENT, ["field_agent"]) });
    expect(r.statusCode).toBe(200);
    expect(H.taskList.mock.calls[0]![3]).toMatchObject({ assigneeId: AGENT });
    await app.close();
  });

  it("GET /visits and /visits/by-task are filtered to the caller", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/field/visits", headers: auth(AGENT, ["field_agent"]) });
    expect(H.visitList.mock.calls[0]![3]).toBe(AGENT);
    await app.inject({ method: "GET", url: `/v1/field/visits/by-task/${ID}`, headers: auth(AGENT, ["field_agent"]) });
    expect(H.visitByTask.mock.calls[0]![4]).toBe(AGENT);
    await app.close();
  });

  it("GET /routes is filtered to the caller", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/field/routes", headers: auth(AGENT, ["field_agent"]) });
    expect(H.routeList.mock.calls[0]![3]).toBe(AGENT);
    await app.close();
  });

  it("another agent's visits/routes by-agent lookups are 403", async () => {
    const app = await buildApp();
    const v = await app.inject({ method: "GET", url: `/v1/field/visits/by-agent/${OTHER}`, headers: auth(AGENT, ["field_agent"]) });
    expect(v.statusCode).toBe(403);
    const r = await app.inject({ method: "GET", url: `/v1/field/routes/by-agent?assigneeId=${OTHER}&date=2025-01-15`, headers: auth(AGENT, ["field_agent"]) });
    expect(r.statusCode).toBe(403);
    expect(H.visitByAgent).not.toHaveBeenCalled();
    await app.close();
  });

  it("single-record reads of another agent's task/visit/route are 404", async () => {
    H.taskFind.mockResolvedValue({ id: ID, tenantId: TENANT, assigneeId: OTHER });
    H.visitFind.mockResolvedValue({ id: ID, tenantId: TENANT, agentId: OTHER });
    H.routeFind.mockResolvedValue({ id: ID, tenantId: TENANT, assigneeId: OTHER });
    const app = await buildApp();
    for (const p of ["tasks", "visits", "routes"]) {
      const r = await app.inject({ method: "GET", url: `/v1/field/${p}/${ID}`, headers: auth(AGENT, ["field_agent"]) });
      expect(r.statusCode, p).toBe(404);
    }
    await app.close();
  });

  it("GET /agents (tenant-wide roster) is 403 for a field_agent and never queried", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/field/agents", headers: auth(AGENT, ["field_agent"]) });
    expect(r.statusCode).toBe(403);
    expect(taskRepo.listAgents).not.toHaveBeenCalled();
    await app.close();
  });

  it("GET /dashboard/kpis is scoped to the caller for a field_agent", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/field/dashboard/kpis", headers: auth(AGENT, ["field_agent"]) });
    expect(r.statusCode).toBe(200);
    expect(vi.mocked(taskRepo.getKpis).mock.calls[0]).toEqual([TENANT, AGENT]);
    await app.close();
  });

  it("own records are still readable", async () => {
    H.visitFind.mockResolvedValue({ id: ID, tenantId: TENANT, agentId: AGENT });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/field/visits/${ID}`, headers: auth(AGENT, ["field_agent"]) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});

describe("supervisor keeps tenant-wide reads", () => {
  it.each([["field_admin"], ["super_admin"]])("%s lists everything and may pass assigneeId", async (role) => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: `/v1/field/tasks?assigneeId=${OTHER}`, headers: auth(AGENT, [role]) });
    expect(H.taskList.mock.calls[0]![3]).toMatchObject({ assigneeId: OTHER });
    await app.inject({ method: "GET", url: "/v1/field/visits", headers: auth(AGENT, [role]) });
    expect(H.visitList.mock.calls[0]![3]).toBeUndefined();
    await app.inject({ method: "GET", url: "/v1/field/routes", headers: auth(AGENT, [role]) });
    expect(H.routeList.mock.calls[0]![3]).toBeUndefined();
    const v = await app.inject({ method: "GET", url: `/v1/field/visits/by-agent/${OTHER}`, headers: auth(AGENT, [role]) });
    expect(v.statusCode).toBe(200);
    const a = await app.inject({ method: "GET", url: "/v1/field/agents", headers: auth(AGENT, [role]) });
    expect(a.statusCode).toBe(200);
    await app.inject({ method: "GET", url: "/v1/field/dashboard/kpis", headers: auth(AGENT, [role]) });
    expect(vi.mocked(taskRepo.getKpis).mock.calls[0]).toEqual([TENANT, undefined]);
    await app.close();
  });
});
