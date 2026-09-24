/**
 * WAVE-4 gap closure — route-level unit tests (mocked DB) for the WFH and
 * shift-change request routes: validation, auth, role, and IDOR checks that
 * don't need a real Postgres. Real end-to-end behaviour (actual persistence,
 * the self-decide guard, and the already-decided guard) is covered by
 * self-service-requests-e2e.test.ts against a real DB instead -- the same
 * split this module already has between attendance-routes.test.ts (mocked)
 * and f3-consumer.test.ts / geo-attendance-e2e.test.ts (real DB). Mocking
 * harness copied verbatim from attendance-routes.test.ts.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createMockSqlClient } from "./fixtures/mock-sql-client.js";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0002-4000-8000-000000000002";
const REQUESTER = "eeeeeeee-2222-4000-8000-000000000001";
const OTHER_EMP = "eeeeeeee-2222-4000-8000-000000000002";
const HR_ADMIN = "aaaaaaaa-9999-4000-8000-000000000009";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const createSelectChain = (...args: unknown[]) => ({
    from: (t: unknown) => ({
      where: (...w: unknown[]) => {
        const result = H.selectFrom(...args, ...w);
        const limitObj = {
          offset: (n: unknown) => H.selectFrom(...args, ...w),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(result).then(resolve, reject),
        };
        return {
          limit: (n: unknown) => limitObj,
          orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => limitObj }),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => Promise.resolve(result).then(resolve, reject),
        };
      },
      orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => ({ offset: (n2: unknown) => H.selectFrom(...args) }) }),
    }),
  });
  const mockTx = {
    select: (...args: unknown[]) => createSelectChain(...args),
    update: (t: unknown) => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => H.update(v, ...a) }) }),
    insert: (t: unknown) => ({ values: (v: unknown) => H.insert(v), $returningId: () => ({ values: (v: unknown) => H.insert(v) }) }),
    execute: (q: unknown) => H.execute(q),
  };
  return {
    db: { transaction: async (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx), execute: (q: unknown) => H.execute(q) },
    scopedRead: async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    sqlClient: createMockSqlClient(),
    sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: async () => {},
    makeKey: (...a: string[]) => a.join(":"),
    getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn(),
    listKey: (...a: string[]) => a.join(":"),
    listOrLoad: async (_t: string, _ns: string, _k: string, fn: () => Promise<unknown>) => fn(),
  },
  queue: { publish: async () => {} },
}));

import { buildApp } from "../src/app.js";

const auth = (sub: string, roles: string[]) =>
  ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}` });

beforeEach(() => {
  vi.clearAllMocks();
  H.selectFrom.mockResolvedValue([]);
  H.insert.mockResolvedValue(undefined);
  H.update.mockResolvedValue(undefined);
  H.execute.mockResolvedValue([]);
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

describe("POST /v1/hrms/wfh-requests", () => {
  const validBody = { employeeId: REQUESTER, fromDate: "2026-10-05", toDate: "2026-10-06", reason: "Family care" };

  it("202 — employee can file their own request", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/wfh-requests",
      headers: { ...auth(REQUESTER, ["employee"]), "content-type": "application/json" },
      payload: validBody,
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("pending");
    expect(r.json().id).toBeTruthy();
    await app.close();
  });

  it("400 — toDate before fromDate", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/wfh-requests",
      headers: { ...auth(REQUESTER, ["employee"]), "content-type": "application/json" },
      payload: { ...validBody, fromDate: "2026-10-06", toDate: "2026-10-05" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid date format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/wfh-requests",
      headers: { ...auth(REQUESTER, ["employee"]), "content-type": "application/json" },
      payload: { ...validBody, fromDate: "05-10-2026" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — missing employeeId", async () => {
    const { employeeId: _drop, ...rest } = validBody;
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/wfh-requests",
      headers: { ...auth(REQUESTER, ["employee"]), "content-type": "application/json" },
      payload: rest,
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/wfh-requests", payload: validBody });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — an employee cannot file a WFH request on someone else's behalf", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/wfh-requests",
      headers: { ...auth(REQUESTER, ["employee"]), "content-type": "application/json" },
      payload: { ...validBody, employeeId: OTHER_EMP },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("202 — hr_admin can file on behalf of another employee", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/wfh-requests",
      headers: { ...auth(HR_ADMIN, ["hr_admin"]), "content-type": "application/json" },
      payload: { ...validBody, employeeId: OTHER_EMP },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });
});

describe("PATCH /v1/hrms/wfh-requests/:id/approve|reject", () => {
  const REQ_ID = "ffffffff-1111-4000-8000-000000000001";

  it("202 — manager approves a pending request filed by someone else", async () => {
    H.selectFrom.mockResolvedValue([{ id: REQ_ID, employeeId: REQUESTER, status: "pending" }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/wfh-requests/${REQ_ID}/approve`,
      headers: auth(OTHER_EMP, ["manager"]),
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("403 — the requester cannot approve their own request", async () => {
    H.selectFrom.mockResolvedValue([{ id: REQ_ID, employeeId: REQUESTER, status: "pending" }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/wfh-requests/${REQ_ID}/approve`,
      headers: auth(REQUESTER, ["manager"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — already-decided request cannot be re-decided", async () => {
    H.selectFrom.mockResolvedValue([{ id: REQ_ID, employeeId: REQUESTER, status: "approved" }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/wfh-requests/${REQ_ID}/reject`,
      headers: auth(OTHER_EMP, ["manager"]),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("404 — unknown id", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/wfh-requests/${REQ_ID}/approve`,
      headers: auth(OTHER_EMP, ["manager"]),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("403 — plain employee role cannot approve at all", async () => {
    H.selectFrom.mockResolvedValue([{ id: REQ_ID, employeeId: REQUESTER, status: "pending" }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/wfh-requests/${REQ_ID}/approve`,
      headers: auth(OTHER_EMP, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/wfh-requests/${REQ_ID}/approve` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("POST /v1/hrms/shift-requests", () => {
  const validBody = {
    employeeId: REQUESTER, currentShift: "Morning Shift", requestedShift: "Evening Shift",
    effectiveDate: "2026-10-05", reason: "Childcare",
  };

  it("202 — employee can file their own request", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/shift-requests",
      headers: { ...auth(REQUESTER, ["employee"]), "content-type": "application/json" },
      payload: validBody,
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("pending");
    await app.close();
  });

  it("400 — missing requestedShift", async () => {
    const { requestedShift: _drop, ...rest } = validBody;
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/shift-requests",
      headers: { ...auth(REQUESTER, ["employee"]), "content-type": "application/json" },
      payload: rest,
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid effectiveDate format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/shift-requests",
      headers: { ...auth(REQUESTER, ["employee"]), "content-type": "application/json" },
      payload: { ...validBody, effectiveDate: "not-a-date" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/shift-requests", payload: validBody });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — an employee cannot file a shift-change request on someone else's behalf", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/shift-requests",
      headers: { ...auth(REQUESTER, ["employee"]), "content-type": "application/json" },
      payload: { ...validBody, employeeId: OTHER_EMP },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("PATCH /v1/hrms/shift-requests/:id/approve|reject", () => {
  const REQ_ID = "ffffffff-2222-4000-8000-000000000002";

  it("202 — manager rejects a pending request filed by someone else", async () => {
    H.selectFrom.mockResolvedValue([{ id: REQ_ID, employeeId: REQUESTER, status: "pending" }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/shift-requests/${REQ_ID}/reject`,
      headers: { ...auth(OTHER_EMP, ["manager"]), "content-type": "application/json" },
      payload: { reason: "Not feasible" },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("403 — the requester cannot reject their own request", async () => {
    H.selectFrom.mockResolvedValue([{ id: REQ_ID, employeeId: REQUESTER, status: "pending" }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/shift-requests/${REQ_ID}/reject`,
      headers: auth(REQUESTER, ["manager"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — already-decided request cannot be re-decided", async () => {
    H.selectFrom.mockResolvedValue([{ id: REQ_ID, employeeId: REQUESTER, status: "rejected" }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/shift-requests/${REQ_ID}/reject`,
      headers: auth(OTHER_EMP, ["manager"]),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("GET /v1/hrms/wfh-requests and /v1/hrms/shift-requests — auth", () => {
  it("401 — no auth header (wfh)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/wfh-requests" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("401 — no auth header (shift-requests)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/shift-requests" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
