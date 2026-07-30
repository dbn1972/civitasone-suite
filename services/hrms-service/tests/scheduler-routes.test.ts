/**
 * Scheduler route-level tests — comprehensive coverage:
 * happy paths, 400 validation, 401 unauthenticated, 403 forbidden.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  runSchedulerOnceMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const createSelectChain = (...args: unknown[]) => ({
    from: (t: unknown) => ({
      where: (...w: unknown[]) => {
        const result = H.selectFrom(...args, ...w);
        return {
          limit: (n: unknown) => H.selectFrom(...args, ...w),
          orderBy: (...o: unknown[]) => ({
            limit: (n: unknown) => H.selectFrom(...args, ...w),
          }),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(result).then(resolve, reject),
        };
      },
      orderBy: (...o: unknown[]) => ({
        limit: (n: unknown) => H.selectFrom(...args),
        then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
          Promise.resolve(H.selectFrom(...args)).then(resolve, reject),
      }),
    }),
  });
  const mockTx = {
    select: (...args: unknown[]) => createSelectChain(...args),
    update: (t: unknown) => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => H.update(v, ...a) }) }),
    insert: (t: unknown) => ({ values: (v: unknown) => H.insert(v) }),
    execute: (q: unknown) => H.execute(q),
  };
  return {
    db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx) },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: { end: async () => {} },
    sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: async () => {},
    makeKey: (...a: string[]) => a.join(":"),
    getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn(),
  },
  queue: { publish: async () => {} },
}));

vi.mock("../src/modules/scheduler/tick.js", () => ({
  runSchedulerOnce: (...a: unknown[]) => H.runSchedulerOnceMock(...a),
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

function dueListRow(over: Record<string, unknown> = {}) {
  return {
    id: "dddddddd-1111-4000-8000-000000000001",
    tenantId: TENANT, listKind: "superannuation",
    runDate: "2026-07-26", employeeId: "eeeeeeee-1111-4000-8000-000000000001",
    employeeNo: "EMP-001", fullName: "John Doe",
    dueDate: "2027-01-15", daysRemaining: 173,
    details: {}, createdAt: new Date(),
    ...over,
  };
}

function runRow(over: Record<string, unknown> = {}) {
  return {
    id: "ffffffff-1111-4000-8000-000000000001",
    jobName: "hr_due_lists", runDate: "2026-07-26",
    startedAt: new Date(), finishedAt: new Date(),
    tenantsSeen: 2, rowsProduced: 15,
    status: "ok", detail: "superannuation=10, probation=5, tenantsFailed=0",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.selectFrom.mockReturnValue([dueListRow()]);
  H.insert.mockResolvedValue(undefined);
  H.update.mockResolvedValue(undefined);
  H.execute.mockResolvedValue([]);
  H.runSchedulerOnceMock.mockResolvedValue({
    runDate: "2026-07-26", tenantsSeen: 1,
    superannuationRows: 5, probationRows: 3,
    tenantsFailed: 0, outcomes: [],
  });
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// ===================== GET /v1/hrms/scheduler/due-list =====================
describe("GET /v1/hrms/scheduler/due-list", () => {
  it("200 — returns due-list for superannuation", async () => {
    H.selectFrom.mockReturnValue([dueListRow()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/scheduler/due-list?kind=superannuation",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.kind).toBe("superannuation");
    expect(body.data).toBeDefined();
    await app.close();
  });

  it("200 — returns due-list for probation", async () => {
    H.selectFrom.mockReturnValue([dueListRow({ listKind: "probation" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/scheduler/due-list?kind=probation",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().kind).toBe("probation");
    await app.close();
  });

  it("200 — with explicit runDate", async () => {
    H.selectFrom.mockReturnValue([dueListRow()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/scheduler/due-list?kind=superannuation&runDate=2026-07-26",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().runDate).toBe("2026-07-26");
    await app.close();
  });

  it("200 — empty result when no run exists", async () => {
    H.selectFrom.mockReturnValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/scheduler/due-list?kind=superannuation",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.runDate).toBeNull();
    expect(body.data).toHaveLength(0);
    await app.close();
  });

  it("400 — missing kind parameter", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/scheduler/due-list",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — invalid kind value", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/scheduler/due-list?kind=invalid",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid runDate format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/scheduler/due-list?kind=superannuation&runDate=26-07-2026",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/scheduler/due-list?kind=superannuation",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — wrong role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/scheduler/due-list?kind=superannuation",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ===================== GET /v1/hrms/scheduler/runs =====================
describe("GET /v1/hrms/scheduler/runs", () => {
  it("200 — returns recent runs", async () => {
    H.selectFrom.mockReturnValue([runRow()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/scheduler/runs",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].jobName).toBe("hr_due_lists");
    await app.close();
  });

  it("200 — empty runs list", async () => {
    H.selectFrom.mockReturnValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/scheduler/runs",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/scheduler/runs",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — wrong role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/scheduler/runs",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ===================== POST /v1/hrms/scheduler/run =====================
describe("POST /v1/hrms/scheduler/run", () => {
  it("200 — triggers a manual run (no body)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/scheduler/run",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.runDate).toBe("2026-07-26");
    expect(body.tenantsSeen).toBe(1);
    expect(H.runSchedulerOnceMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("200 — triggers with custom asOf date", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/scheduler/run",
      headers: auth(),
      payload: { asOf: "2026-08-01" },
    });
    expect(r.statusCode).toBe(200);
    const args = H.runSchedulerOnceMock.mock.calls[0];
    expect(args[1]).toMatchObject({ asOf: "2026-08-01" });
    await app.close();
  });

  it("200 — triggers with custom window days", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/scheduler/run",
      headers: auth(),
      payload: { superannuationWithinDays: 365, probationWithinDays: 90 },
    });
    expect(r.statusCode).toBe(200);
    const args = H.runSchedulerOnceMock.mock.calls[0];
    expect(args[1]).toMatchObject({
      superannuationWithinDays: 365,
      probationWithinDays: 90,
    });
    await app.close();
  });

  it("400 — invalid asOf format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/scheduler/run",
      headers: auth(),
      payload: { asOf: "26-07-2026" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — superannuationWithinDays out of range (0)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/scheduler/run",
      headers: auth(),
      payload: { superannuationWithinDays: 0 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — probationWithinDays exceeds max (3651)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/scheduler/run",
      headers: auth(),
      payload: { probationWithinDays: 3651 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/scheduler/run",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — hr_officer cannot trigger (needs admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/scheduler/run",
      headers: auth(USER, ["hr_officer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/scheduler/run",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
