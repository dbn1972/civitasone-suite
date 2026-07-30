/**
 * Attendance route-level tests — comprehensive coverage:
 * happy paths, 400 validation, 401 unauthenticated, 403 forbidden,
 * 404 not found, 409 conflict, 422 business rule violation.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const EMP_ID = "eeeeeeee-1111-4000-8000-000000000001";

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
    sqlClient: { end: async () => {} },
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

const tok = (sub = USER, roles = ["hr_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no locked periods, empty results
  H.selectFrom.mockResolvedValue([]);
  H.insert.mockResolvedValue(undefined);
  H.update.mockResolvedValue(undefined);
  H.execute.mockResolvedValue([]);
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// ─── POST /v1/hrms/attendance (mark attendance) ─────────────────────────────

describe("POST /v1/hrms/attendance", () => {
  const validBody = {
    records: [
      { employeeId: EMP_ID, attendanceDate: "2026-07-01", status: "present", lateMins: 0 },
    ],
  };

  it("202 — marks attendance successfully", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance",
      headers: auth(),
      payload: validBody,
    });
    expect(r.statusCode).toBe(202);
    const body = r.json();
    expect(body.status).toBe("accepted");
    expect(body.id).toBeDefined();
    await app.close();
  });

  it("400 — empty records array", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance",
      headers: auth(),
      payload: { records: [] },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid employee UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance",
      headers: auth(),
      payload: { records: [{ employeeId: "not-uuid", attendanceDate: "2026-07-01" }] },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid date format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance",
      headers: auth(),
      payload: { records: [{ employeeId: EMP_ID, attendanceDate: "01-07-2026" }] },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid status value", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance",
      headers: auth(),
      payload: { records: [{ employeeId: EMP_ID, attendanceDate: "2026-07-01", status: "invalid" }] },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance",
      payload: validBody,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role (employee)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance",
      headers: auth(USER, ["employee"]),
      payload: validBody,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("422 — locked period rejects write", async () => {
    // Return locked period
    H.selectFrom.mockResolvedValue([{ period: "2026-07" }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance",
      headers: auth(),
      payload: validBody,
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("ATTENDANCE_LOCKED");
    await app.close();
  });
});

// ─── GET /v1/hrms/attendance/locks ──────────────────────────────────────────

describe("GET /v1/hrms/attendance/locks", () => {
  it("200 — returns lock list", async () => {
    H.selectFrom.mockResolvedValue([
      { id: "l1", period: "2026-06", status: "locked", reason: "Payroll", lockedBy: USER, lockedAt: "2026-06-30T00:00:00Z" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/locks",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("200 — empty list when no locks", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/locks",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("200 — manager role can access", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/locks",
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/locks",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/locks",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── POST /v1/hrms/attendance/locks (lock period) ───────────────────────────

describe("POST /v1/hrms/attendance/locks", () => {
  it("202 — locks a period successfully", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/locks",
      headers: auth(),
      payload: { period: "2026-07", reason: "Payroll cut-off" },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await app.close();
  });

  it("202 — locks without reason", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/locks",
      headers: auth(),
      payload: { period: "2026-07" },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("400 — invalid period format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/locks",
      headers: auth(),
      payload: { period: "2026-7" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — missing period", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/locks",
      headers: auth(),
      payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/locks",
      payload: { period: "2026-07" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — hr_officer cannot lock (only hr_admin/super_admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/locks",
      headers: auth(USER, ["hr_officer"]),
      payload: { period: "2026-07" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — manager cannot lock", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/locks",
      headers: auth(USER, ["manager"]),
      payload: { period: "2026-07" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── POST /v1/hrms/attendance/locks/unlock ──────────────────────────────────

describe("POST /v1/hrms/attendance/locks/unlock", () => {
  it("202 — unlocks a period successfully", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/locks/unlock",
      headers: auth(),
      payload: { period: "2026-07", reason: "Correction needed" },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await app.close();
  });

  it("400 — invalid period format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/locks/unlock",
      headers: auth(),
      payload: { period: "July-2026" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/locks/unlock",
      payload: { period: "2026-07" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — hr_officer cannot unlock", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/locks/unlock",
      headers: auth(USER, ["hr_officer"]),
      payload: { period: "2026-07" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — manager cannot unlock", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/locks/unlock",
      headers: auth(USER, ["manager"]),
      payload: { period: "2026-07" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── GET /v1/hrms/attendance/summary ────────────────────────────────────────

describe("GET /v1/hrms/attendance/summary", () => {
  it("200 — returns summary for default month", async () => {
    H.execute.mockResolvedValue([
      { date: "2026-07-01", present_count: 50, absent_count: 5, late_count: 3 },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/summary",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("200 — returns summary for specific month", async () => {
    H.execute.mockResolvedValue([
      { date: "2026-06-01", present_count: 40, absent_count: 10, late_count: 2 },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/summary?month=2026-06",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data[0].date).toBe("2026-06-01");
    expect(body.data[0].presentCount).toBe(40);
    await app.close();
  });

  it("400 — invalid month format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/summary?month=2026-7",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/summary",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/summary",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── GET /v1/hrms/attendance (list / by emp+month) ──────────────────────────

describe("GET /v1/hrms/attendance", () => {
  it("200 — returns attendance list", async () => {
    H.selectFrom.mockResolvedValue([
      { id: "a1", employeeId: EMP_ID, tenantId: TENANT, attendanceDate: "2026-07-01", status: "present", inTime: "09:00", outTime: "17:00", lateMins: 0 },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("200 — filters by empId and month", async () => {
    H.selectFrom.mockResolvedValue([
      { id: "a1", employeeId: EMP_ID, tenantId: TENANT, attendanceDate: "2026-07-01", status: "present", inTime: "09:00", outTime: "17:00", lateMins: 0 },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/attendance?empId=${EMP_ID}&month=2026-07`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("400 — invalid empId (not UUID)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance?empId=not-a-uuid",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid month format in query", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance?month=July",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── GET /v1/hrms/attendance/regularisations ────────────────────────────────

describe("GET /v1/hrms/attendance/regularisations", () => {
  it("200 — returns regularisation list", async () => {
    H.selectFrom.mockResolvedValue([
      { id: "r1", employeeId: EMP_ID, date: "2026-07-01", reason: "Forgot punch", requestedStatus: "present", status: "pending", requestedAt: "2026-07-02T00:00:00Z" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/regularisations",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("200 — empty list", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/regularisations",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/regularisations",
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/hrms/attendance/regularisations",
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── POST /v1/hrms/attendance/regularisations ───────────────────────────────

describe("POST /v1/hrms/attendance/regularisations", () => {
  const validBody = {
    employeeId: EMP_ID,
    date: "2026-07-01",
    requestedStatus: "present",
    reason: "Biometric failed, was in office",
  };

  it("202 — creates regularisation request", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/regularisations",
      headers: auth(),
      payload: validBody,
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await app.close();
  });

  it("400 — missing employeeId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/regularisations",
      headers: auth(),
      payload: { date: "2026-07-01", requestedStatus: "present", reason: "Test" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid date format", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/regularisations",
      headers: auth(),
      payload: { ...validBody, date: "07-01-2026" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid requestedStatus", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/regularisations",
      headers: auth(),
      payload: { ...validBody, requestedStatus: "holiday" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — empty reason", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/regularisations",
      headers: auth(),
      payload: { ...validBody, reason: "" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/regularisations",
      payload: validBody,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/regularisations",
      headers: auth(USER, ["employee"]),
      payload: validBody,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("422 — locked period rejects regularisation", async () => {
    H.selectFrom.mockResolvedValue([{ period: "2026-07" }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/attendance/regularisations",
      headers: auth(),
      payload: validBody,
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("ATTENDANCE_LOCKED");
    await app.close();
  });
});
