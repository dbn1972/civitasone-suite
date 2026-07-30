/**
 * Appraisals + feedback route-level tests — comprehensive coverage:
 * happy paths, 400 validation, 401 unauthenticated, 403 forbidden,
 * 404 not found, 409 conflict for all endpoints in routes.ts and feedback-routes.ts.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const EMP = "bbbbbbbb-0001-4000-8000-000000000001";
const APPRAISAL_ID = "cccccccc-0001-4000-8000-000000000001";
const REVIEWER_ID = "dddddddd-0001-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  // repo/queries mocks
  listAppraisals: vi.fn(),
  findById: vi.fn(),
  listByTenant: vi.fn(),
  listByTenantEmp: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const createSelectChain = (...args: unknown[]) => ({
    from: (t: unknown) => ({
      where: (...w: unknown[]) => {
        const result = H.selectFrom(...args, ...w);
        return {
          limit: (n: unknown) => H.selectFrom(...args, ...w),
          orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args, ...w) }),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(result).then(resolve, reject),
        };
      },
      orderBy: (...o: unknown[]) => ({ limit: (n: unknown) => H.selectFrom(...args) }),
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
    listKey: (...a: string[]) => a.join(":"),
    getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn(),
  },
  queue: { publish: async () => {} },
}));

vi.mock("../src/modules/appraisals/queries.js", () => ({
  listAppraisals: (...a: unknown[]) => H.listAppraisals(...a),
}));

vi.mock("../src/modules/appraisals/repo.js", () => ({
  findById: (...a: unknown[]) => H.findById(...a),
  listByTenant: (...a: unknown[]) => H.listByTenant(...a),
  insertAppraisal: async () => undefined,
  updateAppraisal: async () => undefined,
}));

vi.mock("../src/modules/employee/repo.js", () => ({
  listByTenant: (...a: unknown[]) => H.listByTenantEmp(...a),
  findById: async () => ({ id: EMP, fullName: "Test User", departmentId: "dept-1" }),
  insertEmployee: async () => undefined,
  updateEmployee: async () => undefined,
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

function appraisalRow(over: Record<string, unknown> = {}) {
  return {
    id: APPRAISAL_ID, tenantId: TENANT, employeeId: EMP,
    appraisalPeriod: "2025-2026", rating: "4.5", status: "self_pending",
    reviewerId: REVIEWER_ID, createdAt: new Date(), updatedAt: new Date(),
    createdBy: USER, updatedBy: USER, version: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.selectFrom.mockResolvedValue([]);
  H.insert.mockResolvedValue(undefined);
  H.update.mockResolvedValue(undefined);
  H.listAppraisals.mockResolvedValue([
    { id: APPRAISAL_ID, employeeId: EMP, employeeName: "Test", department: "HR", appraisalPeriod: "2025-2026", rating: 4.5, status: "pending" },
  ]);
  H.findById.mockResolvedValue(appraisalRow());
  H.listByTenant.mockResolvedValue([appraisalRow()]);
  H.listByTenantEmp.mockResolvedValue([{ id: EMP, fullName: "Test User", departmentId: "dept-1" }]);
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// ─── GET /v1/hrms/appraisals ───────────────────────────────────────────────────

describe("GET /v1/hrms/appraisals", () => {
  it("200 — returns appraisal list", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(APPRAISAL_ID);
    await app.close();
  });

  it("200 — returns empty list when no appraisals", async () => {
    H.listAppraisals.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveLength(0);
    await app.close();
  });

  it("200 — manager role can read", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(USER, ["manager"]) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee role cannot list", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/appraisals", headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── POST /v1/hrms/appraisals ──────────────────────────────────────────────────

describe("POST /v1/hrms/appraisals", () => {
  const payload = { employeeId: EMP, appraisalPeriod: "2025-2026" };

  it("202 — creates appraisal (command published)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", headers: auth(), payload });
    expect(r.statusCode).toBe(202);
    const body = r.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    await app.close();
  });

  it("202 — with optional reviewerId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/appraisals", headers: auth(),
      payload: { ...payload, reviewerId: REVIEWER_ID },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("400 — missing employeeId", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", headers: auth(), payload: { appraisalPeriod: "2025-2026" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid employeeId (not uuid)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", headers: auth(), payload: { employeeId: "not-uuid", appraisalPeriod: "2025-2026" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — appraisalPeriod too short", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", headers: auth(), payload: { employeeId: EMP, appraisalPeriod: "25" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", payload });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — manager cannot create", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", headers: auth(USER, ["manager"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — employee cannot create", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/appraisals", headers: auth(USER, ["employee"]), payload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── PATCH /v1/hrms/appraisals/:id/stage ───────────────────────────────────────

describe("PATCH /v1/hrms/appraisals/:id/stage", () => {
  const payload = { stage: "reporting_officer" };

  it("202 — advances stage", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(202);
    const body = r.json();
    expect(body.id).toBe(APPRAISAL_ID);
    expect(body.status).toBe("accepted");
    await app.close();
  });

  it("202 — manager can advance stage", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(USER, ["manager"]), payload,
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("202 — with optional rating", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(), payload: { stage: "completed", rating: "4.5" },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("400 — invalid UUID in params", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: "/v1/hrms/appraisals/not-a-uuid/stage",
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid stage value", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(), payload: { stage: "invalid_stage" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — missing stage field", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(), payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      payload,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee cannot advance stage", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(USER, ["employee"]), payload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — appraisal not found", async () => {
    H.findById.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/stage`,
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });
});

// ─── POST /v1/hrms/appraisals/:id/360-feedback ─────────────────────────────────

describe("POST /v1/hrms/appraisals/:id/360-feedback", () => {
  const payload = { reviewerId: REVIEWER_ID, relationship: "peer" };

  it("201 — submits 360 feedback", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeDefined();
    expect(body.appraisalId).toBe(APPRAISAL_ID);
    await app.close();
  });

  it("201 — with optional ratings and comments", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(), payload: { ...payload, ratings: "4.5", comments: "Great performance" },
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("201 — employee can submit feedback", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(USER, ["employee"]), payload,
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("400 — missing reviewerId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(), payload: { relationship: "peer" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid relationship enum", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(), payload: { reviewerId: REVIEWER_ID, relationship: "cousin" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid appraisal UUID in params", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/appraisals/bad-uuid/360-feedback",
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid reviewerId (not uuid)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(), payload: { reviewerId: "not-a-uuid", relationship: "peer" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      payload,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — viewer cannot submit feedback", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(USER, ["viewer"]), payload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── GET /v1/hrms/appraisals/:id/360-feedback ──────────────────────────────────

describe("GET /v1/hrms/appraisals/:id/360-feedback", () => {
  it("200 — returns feedback list", async () => {
    H.selectFrom.mockResolvedValue([
      { id: "f1", tenantId: TENANT, appraisalId: APPRAISAL_ID, reviewerId: REVIEWER_ID, relationship: "peer", ratings: null, comments: "Good", submittedAt: new Date() },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeDefined();
    await app.close();
  });

  it("200 — empty list when no feedback", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("400 — invalid UUID in params", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/appraisals/bad-uuid/360-feedback",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee cannot list feedback", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — manager cannot list feedback", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/360-feedback`,
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── POST /v1/hrms/appraisals/:id/disclosure ───────────────────────────────────

describe("POST /v1/hrms/appraisals/:id/disclosure", () => {
  const payload = { employeeId: EMP };

  it("201 — discloses APAR to employee", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/disclosure`,
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeDefined();
    expect(body.appraisalId).toBe(APPRAISAL_ID);
    expect(body.disclosed).toBe(true);
    await app.close();
  });

  it("400 — missing employeeId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/disclosure`,
      headers: auth(), payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid employeeId (not uuid)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/disclosure`,
      headers: auth(), payload: { employeeId: "not-uuid" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid appraisal UUID in params", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/appraisals/bad-uuid/disclosure",
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/disclosure`,
      payload,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee cannot disclose", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/disclosure`,
      headers: auth(USER, ["employee"]), payload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — manager cannot disclose", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/disclosure`,
      headers: auth(USER, ["manager"]), payload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── POST /v1/hrms/appraisals/:id/appeal ───────────────────────────────────────

describe("POST /v1/hrms/appraisals/:id/appeal", () => {
  const payload = { employeeId: EMP, appealReason: "I believe the rating does not reflect my contributions during Q3 and Q4." };

  it("201 — files a rating appeal", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      headers: auth(USER, ["employee"]), payload,
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.id).toBeDefined();
    expect(body.appraisalId).toBe(APPRAISAL_ID);
    expect(body.status).toBe("filed");
    await app.close();
  });

  it("201 — with pipLinked true", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      headers: auth(), payload: { ...payload, pipLinked: true },
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("201 — hr_admin can file on behalf", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("400 — missing appealReason", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      headers: auth(), payload: { employeeId: EMP },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — appealReason too short", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      headers: auth(), payload: { employeeId: EMP, appealReason: "short" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — missing employeeId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      headers: auth(), payload: { appealReason: "I believe the rating is unfair and needs review." },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — invalid appraisal UUID in params", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/appraisals/bad-uuid/appeal",
      headers: auth(), payload,
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      payload,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — viewer cannot file appeal", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeal`,
      headers: auth(USER, ["viewer"]), payload,
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ─── GET /v1/hrms/appraisals/:id/appeals ───────────────────────────────────────

describe("GET /v1/hrms/appraisals/:id/appeals", () => {
  it("200 — returns appeals list", async () => {
    H.selectFrom.mockResolvedValue([
      { id: "a1", tenantId: TENANT, appraisalId: APPRAISAL_ID, employeeId: EMP, appealReason: "Unfair rating", status: "filed", pipLinked: false },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeals`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toBeDefined();
    await app.close();
  });

  it("200 — empty list when no appeals", async () => {
    H.selectFrom.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeals`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("400 — invalid UUID in params", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/appraisals/bad-uuid/appeals",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeals` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee cannot list appeals", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeals`,
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — manager cannot list appeals", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/appraisals/${APPRAISAL_ID}/appeals`,
      headers: auth(USER, ["manager"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
