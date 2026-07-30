/**
 * Reservation route-level tests — comprehensive coverage:
 * happy paths, 400 validation, 401 unauthenticated, 403 forbidden,
 * 404 not found.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const ROSTER_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const POST_ID = "cccccccc-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  selectFrom: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  execute: vi.fn(),
  deleteFn: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => {
  const createSelectChain = (...args: unknown[]) => ({
    from: (t: unknown) => ({
      where: (...w: unknown[]) => {
        const result = H.selectFrom(...args, ...w);
        return {
          limit: (n: unknown) => H.selectFrom(...args, ...w),
          orderBy: (...o: unknown[]) => {
            const r = H.selectFrom(...args, ...w);
            return {
              limit: (n: unknown) => H.selectFrom(...args, ...w),
              then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
                Promise.resolve(r).then(resolve, reject),
            };
          },
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(result).then(resolve, reject),
        };
      },
      orderBy: (...o: unknown[]) => {
        const r = H.selectFrom(...args);
        return {
          limit: (n: unknown) => H.selectFrom(...args),
          then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
            Promise.resolve(r).then(resolve, reject),
        };
      },
    }),
  });
  const mockTx = {
    select: (...args: unknown[]) => createSelectChain(...args),
    update: (t: unknown) => ({ set: (v: unknown) => ({ where: (...a: unknown[]) => H.update(v, ...a) }) }),
    insert: (t: unknown) => ({ values: (v: unknown) => H.insert(v) }),
    delete: (t: unknown) => ({ where: (...a: unknown[]) => H.deleteFn(...a) }),
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

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

function rosterRow(over: Record<string, unknown> = {}) {
  return {
    id: ROSTER_ID, tenantId: TENANT, cadre: "Assistant Director",
    rosterKind: "point100", rosterSize: 100,
    pctSc: "15.00", pctSt: "7.50", pctObc: "27.00",
    pctEws: "10.00", pctPwd: "4.00",
    cfSc: 0, cfSt: 0, cfObc: 0, cfEws: 0, cfUr: 0,
    status: "active",
    createdAt: new Date(), updatedAt: new Date(),
    createdBy: USER, updatedBy: USER, version: 1,
    ...over,
  };
}

function sanctionedPostRow(over: Record<string, unknown> = {}) {
  return {
    id: POST_ID, tenantId: TENANT, cadre: "Section Officer",
    designationId: null, payLevel: "L-10",
    sanctionedStrength: 50, status: "active", remarks: null,
    createdAt: new Date(), updatedAt: new Date(),
    createdBy: USER, updatedBy: USER, version: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: roster found, selectFrom returns roster row
  H.selectFrom.mockReturnValue([rosterRow()]);
  H.insert.mockResolvedValue(undefined);
  H.update.mockResolvedValue(undefined);
  H.execute.mockResolvedValue([{ n: "10" }]);
  H.deleteFn.mockResolvedValue(undefined);
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

// ===================== POST /v1/hrms/reservation/rosters =====================
describe("POST /v1/hrms/reservation/rosters", () => {
  it("201 — creates a roster", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/reservation/rosters",
      headers: auth(), payload: { cadre: "Assistant Director", rosterSize: 100 },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.cadre).toBe("Assistant Director");
    expect(body.rosterSize).toBe(100);
    expect(body.id).toBeDefined();
    await app.close();
  });

  it("400 — missing cadre", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/reservation/rosters",
      headers: auth(), payload: { rosterSize: 100 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — rosterSize exceeds max", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/reservation/rosters",
      headers: auth(), payload: { cadre: "X", rosterSize: 9999 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/reservation/rosters",
      payload: { cadre: "X" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role (employee)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/reservation/rosters",
      headers: auth(USER, ["employee"]), payload: { cadre: "X" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("403 — hr_officer cannot create (needs admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/reservation/rosters",
      headers: auth(USER, ["hr_officer"]), payload: { cadre: "X" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ===================== GET /v1/hrms/reservation/rosters =====================
describe("GET /v1/hrms/reservation/rosters", () => {
  it("200 — lists rosters", async () => {
    H.selectFrom.mockReturnValue([rosterRow()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/reservation/rosters",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("200 — empty list", async () => {
    H.selectFrom.mockReturnValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/reservation/rosters",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/reservation/rosters" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — wrong role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/reservation/rosters",
      headers: auth(USER, ["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ===================== GET /v1/hrms/reservation/rosters/:rid =====================
describe("GET /v1/hrms/reservation/rosters/:rid", () => {
  it("200 — returns roster by id", async () => {
    H.selectFrom.mockReturnValue([rosterRow()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().id).toBe(ROSTER_ID);
    await app.close();
  });

  it("400 — invalid UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/reservation/rosters/not-a-uuid",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — wrong role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}`,
      headers: auth(USER, ["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — roster not found", async () => {
    H.selectFrom.mockReturnValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });
});

// ===================== POST /v1/hrms/reservation/rosters/:rid/vacancies =====================
describe("POST /v1/hrms/reservation/rosters/:rid/vacancies", () => {
  it("200 — computes vacancies with explicit filled counts", async () => {
    H.selectFrom.mockReturnValue([rosterRow()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}/vacancies`,
      headers: auth(),
      payload: { filled: { SC: 5, ST: 2, OBC: 10, EWS: 3, UR: 20 } },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.rosterId).toBe(ROSTER_ID);
    expect(body.categories).toBeDefined();
    expect(body.totals).toBeDefined();
    await app.close();
  });

  it("200 — computes vacancies without explicit filled (from points)", async () => {
    H.selectFrom.mockReturnValue([rosterRow()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}/vacancies`,
      headers: auth(), payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().rosterId).toBe(ROSTER_ID);
    await app.close();
  });

  it("400 — invalid UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/reservation/rosters/bad-id/vacancies",
      headers: auth(), payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}/vacancies`,
      payload: {},
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — wrong role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}/vacancies`,
      headers: auth(USER, ["viewer"]), payload: {},
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — roster not found", async () => {
    H.selectFrom.mockReturnValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}/vacancies`,
      headers: auth(), payload: {},
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

// ===================== POST /v1/hrms/reservation/rosters/:rid/points =====================
describe("POST /v1/hrms/reservation/rosters/:rid/points", () => {
  it("200 — materialises point chart", async () => {
    H.selectFrom.mockReturnValue([rosterRow()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}/points`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.rosterId).toBe(ROSTER_ID);
    expect(body.points).toBe(100);
    expect(body.data).toHaveLength(100);
    await app.close();
  });

  it("400 — invalid UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/reservation/rosters/not-uuid/points",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}/points`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — hr_officer cannot materialise (needs admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}/points`,
      headers: auth(USER, ["hr_officer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — roster not found", async () => {
    H.selectFrom.mockReturnValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}/points`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

// ===================== GET /v1/hrms/reservation/rosters/:rid/points =====================
describe("GET /v1/hrms/reservation/rosters/:rid/points", () => {
  it("200 — returns the point chart", async () => {
    H.selectFrom.mockReturnValue([rosterRow()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}/points`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.rosterId).toBe(ROSTER_ID);
    await app.close();
  });

  it("400 — invalid UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/reservation/rosters/xyz/points",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}/points`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — wrong role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}/points`,
      headers: auth(USER, ["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — roster not found", async () => {
    H.selectFrom.mockReturnValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/reservation/rosters/${ROSTER_ID}/points`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

// ===================== POST /v1/hrms/sanctioned-posts =====================
describe("POST /v1/hrms/sanctioned-posts", () => {
  it("201 — creates sanctioned post", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/sanctioned-posts",
      headers: auth(),
      payload: { cadre: "Section Officer", sanctionedStrength: 50 },
    });
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body.cadre).toBe("Section Officer");
    expect(body.sanctionedStrength).toBe(50);
    expect(body.id).toBeDefined();
    await app.close();
  });

  it("201 — with optional fields", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/sanctioned-posts",
      headers: auth(),
      payload: {
        cadre: "Director", sanctionedStrength: 10,
        designationId: ROSTER_ID, payLevel: "L-14", remarks: "Re-sanctioned",
      },
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("400 — missing cadre", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/sanctioned-posts",
      headers: auth(), payload: { sanctionedStrength: 10 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — missing sanctionedStrength", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/sanctioned-posts",
      headers: auth(), payload: { cadre: "X" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — negative sanctionedStrength", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/sanctioned-posts",
      headers: auth(), payload: { cadre: "X", sanctionedStrength: -5 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/sanctioned-posts",
      payload: { cadre: "X", sanctionedStrength: 10 },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — hr_officer cannot create (needs admin)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/sanctioned-posts",
      headers: auth(USER, ["hr_officer"]),
      payload: { cadre: "X", sanctionedStrength: 10 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ===================== GET /v1/hrms/sanctioned-posts =====================
describe("GET /v1/hrms/sanctioned-posts", () => {
  it("200 — lists sanctioned posts with filled/vacancy", async () => {
    H.selectFrom.mockReturnValue([sanctionedPostRow()]);
    H.execute.mockResolvedValue([{ n: "30" }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/sanctioned-posts",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].filled).toBe(30);
    expect(body.data[0].vacancy).toBe(20);
    await app.close();
  });

  it("200 — empty list", async () => {
    H.selectFrom.mockReturnValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/sanctioned-posts",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/sanctioned-posts" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — wrong role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/sanctioned-posts",
      headers: auth(USER, ["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ===================== GET /v1/hrms/sanctioned-posts/:pid =====================
describe("GET /v1/hrms/sanctioned-posts/:pid", () => {
  it("200 — returns sanctioned post with filled/vacancy", async () => {
    H.selectFrom.mockReturnValue([sanctionedPostRow()]);
    H.execute.mockResolvedValue([{ n: "20" }]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/sanctioned-posts/${POST_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.id).toBe(POST_ID);
    expect(body.filled).toBe(20);
    expect(body.vacancy).toBe(30);
    await app.close();
  });

  it("400 — invalid UUID", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: "/v1/hrms/sanctioned-posts/bad-uuid",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/sanctioned-posts/${POST_ID}`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — wrong role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/sanctioned-posts/${POST_ID}`,
      headers: auth(USER, ["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 — sanctioned post not found", async () => {
    H.selectFrom.mockReturnValue([]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/hrms/sanctioned-posts/${POST_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });
});
