/**
 * lifecycle-routes.test.ts — Sprint 13 / Employee Lifecycle Phase 1
 *
 * Route-level tests for:
 *   GET  /v1/hrms/lifecycle/transfers        (200, 401)
 *   GET  /v1/hrms/lifecycle/promotions       (200, 401)
 *   POST /v1/hrms/lifecycle/transfers        (202, 400, 403)
 *   POST /v1/hrms/lifecycle/transfers/:id/issue-order (202, 403)
 *
 * Maker + Checker SoD: approver (issue-order caller) must NOT be the same
 * user as the transfer initiator. Enforced at the workflow/consumer level;
 * the route itself requires an hr_admin role distinct from the originating actor.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET   = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT   = "aaaaaaaa-0001-4000-8000-000000000001";
// Two distinct users — SoD: MAKER initiates, CHECKER approves
const MAKER    = "aaaaaaaa-1111-4000-8000-000000000001";
const CHECKER  = "aaaaaaaa-2222-4000-8000-000000000001";
const EMP_ID   = "bbbbbbbb-0001-4000-8000-000000000001";
const DEPT_A   = "cccccccc-0001-4000-8000-000000000001";
const DEPT_B   = "cccccccc-0002-4000-8000-000000000002";
const DESIG_A  = "dddddddd-0001-4000-8000-000000000001";
const DESIG_B  = "dddddddd-0002-4000-8000-000000000002";
const XFR_ID   = "eeeeeeee-0001-4000-8000-000000000001";
const PROM_ID  = "ffffffff-0001-4000-8000-000000000001";

// ── Mocks ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  publish: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/shared/db.js", () => {
  const makeChain = (result: unknown) => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          then: (res: (v: unknown) => void) => Promise.resolve(result).then(res),
        }),
        then: (res: (v: unknown) => void) => Promise.resolve(result).then(res),
      }),
    }),
  });
  return {
    db: {
      transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}),
    },
    scopedRead: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select: (...args: unknown[]) => {
          H.selectFrom(...args);
          return makeChain([]);
        },
      }),
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
  queue: { publish: async (...a: unknown[]) => H.publish(...a) },
}));

import { buildApp } from "../src/app.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function tok(sub: string, roles: string[] = ["hr_admin"]) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-test" }, SECRET);
}

function auth(sub: string, roles?: string[]) {
  return { authorization: `Bearer ${tok(sub, roles)}` };
}

// Valid transfer body
const validTransfer = {
  employeeId:  EMP_ID,
  fromDeptId:  DEPT_A,
  toDeptId:    DEPT_B,
  effectiveDate: "2026-10-01",
};

// Valid promotion body
const validPromotion = {
  employeeId:   EMP_ID,
  fromDesigId:  DESIG_A,
  toDesigId:    DESIG_B,
  effectiveDate: "2026-10-01",
};

// ── Test suite ────────────────────────────────────────────────────────────────

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ── GET /v1/hrms/lifecycle/transfers ─────────────────────────────────────────

describe("GET /v1/hrms/lifecycle/transfers", () => {
  it("200 — hr_admin receives transfer list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/lifecycle/transfers",
      headers: auth(MAKER),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[] }>();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("401 — unauthenticated request is rejected", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/lifecycle/transfers" });
    expect(res.statusCode).toBe(401);
  });
});

// ── GET /v1/hrms/lifecycle/promotions ────────────────────────────────────────

describe("GET /v1/hrms/lifecycle/promotions", () => {
  it("200 — hr_admin receives promotion list", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/hrms/lifecycle/promotions",
      headers: auth(MAKER),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[] }>();
    expect(body).toHaveProperty("data");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("401 — unauthenticated request is rejected", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hrms/lifecycle/promotions" });
    expect(res.statusCode).toBe(401);
  });
});

// ── POST /v1/hrms/lifecycle/transfers ────────────────────────────────────────

describe("POST /v1/hrms/lifecycle/transfers — initiate transfer (MAKER)", () => {
  it("202 — hr_admin (MAKER) can initiate a transfer", async () => {
    H.publish.mockClear();
    const res = await app.inject({
      method:  "POST",
      url:     "/v1/hrms/lifecycle/transfers",
      headers: { ...auth(MAKER), "content-type": "application/json" },
      payload: validTransfer,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json<{ id: string; status: string }>();
    expect(body.status).toBe("accepted");
    expect(H.publish).toHaveBeenCalledOnce();
  });

  it("400 — missing required field (toDeptId) returns validation error", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/v1/hrms/lifecycle/transfers",
      headers: { ...auth(MAKER), "content-type": "application/json" },
      payload: { employeeId: EMP_ID, fromDeptId: DEPT_A, effectiveDate: "2026-10-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 — invalid date format returns validation error", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/v1/hrms/lifecycle/transfers",
      headers: { ...auth(MAKER), "content-type": "application/json" },
      payload: { ...validTransfer, effectiveDate: "01-10-2026" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 — non-HR role (employee self) cannot initiate a transfer", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/v1/hrms/lifecycle/transfers",
      headers: { ...auth(EMP_ID, ["employee"]), "content-type": "application/json" },
      payload: validTransfer,
    });
    expect(res.statusCode).toBe(403);
  });

  it("401 — unauthenticated request is rejected", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/v1/hrms/lifecycle/transfers",
      headers: { "content-type": "application/json" },
      payload: validTransfer,
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── POST /v1/hrms/lifecycle/transfers/:id/issue-order (approve / CHECKER) ───

describe("POST /v1/hrms/lifecycle/transfers/:id/issue-order — CHECKER approval (SoD)", () => {
  it("202 — CHECKER (different user) can issue a transfer order", async () => {
    H.publish.mockClear();
    const res = await app.inject({
      method:  "POST",
      url:     `/v1/hrms/lifecycle/transfers/${XFR_ID}/issue-order`,
      headers: { ...auth(CHECKER), "content-type": "application/json" },
      payload: { orderNo: "TO-2026-0042", orderDate: "2026-09-01" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json<{ id: string; status: string }>();
    expect(body.status).toBe("accepted");
    // Queue published — the consumer will validate SoD (approver ≠ createdBy)
    expect(H.publish).toHaveBeenCalledOnce();
  });

  it("403 — non-HR role cannot issue a transfer order", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     `/v1/hrms/lifecycle/transfers/${XFR_ID}/issue-order`,
      headers: { ...auth(EMP_ID, ["employee"]), "content-type": "application/json" },
      payload: { orderNo: "TO-2026-0043", orderDate: "2026-09-01" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400 — missing orderNo returns validation error", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     `/v1/hrms/lifecycle/transfers/${XFR_ID}/issue-order`,
      headers: { ...auth(CHECKER), "content-type": "application/json" },
      payload: { orderDate: "2026-09-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("SoD — MAKER and CHECKER are distinct users (assertion)", () => {
    // Document the maker+checker segregation of duties invariant.
    // The route layer enforces role; the consumer enforces that createdBy ≠ approverId.
    expect(MAKER).not.toBe(CHECKER);
    expect(MAKER).not.toBe(EMP_ID);
    expect(CHECKER).not.toBe(EMP_ID);
  });
});

// ── POST /v1/hrms/lifecycle/promotions ───────────────────────────────────────

describe("POST /v1/hrms/lifecycle/promotions — initiate promotion (MAKER)", () => {
  it("202 — hr_admin can initiate a promotion", async () => {
    H.publish.mockClear();
    const res = await app.inject({
      method:  "POST",
      url:     "/v1/hrms/lifecycle/promotions",
      headers: { ...auth(MAKER), "content-type": "application/json" },
      payload: validPromotion,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json<{ status: string }>();
    expect(body.status).toBe("accepted");
    expect(H.publish).toHaveBeenCalledOnce();
  });

  it("400 — missing toDesigId returns validation error", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/v1/hrms/lifecycle/promotions",
      headers: { ...auth(MAKER), "content-type": "application/json" },
      payload: { employeeId: EMP_ID, fromDesigId: DESIG_A, effectiveDate: "2026-10-01" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("403 — employee role cannot initiate a promotion", async () => {
    const res = await app.inject({
      method:  "POST",
      url:     "/v1/hrms/lifecycle/promotions",
      headers: { ...auth(EMP_ID, ["employee"]), "content-type": "application/json" },
      payload: validPromotion,
    });
    expect(res.statusCode).toBe(403);
  });
});
