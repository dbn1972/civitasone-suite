/**
 * F.6 — routes for the ranked next-best-action surface:
 *   POST /v1/recommendations/nba/generate
 *   GET  /v1/recommendations/nba/:profileId/history
 * Determinism across repeated HTTP calls is asserted here as well as in the
 * pure-domain tests.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
  listForProfileMock: vi.fn(),
  matrixListMock: vi.fn(),
  predictiveFindMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
  markProcessed: vi.fn(async () => true),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (...a: unknown[]) => H.cacheMakeKeyMock(...a),
  },
  queue: { publish: vi.fn() },
}));

vi.mock("../src/modules/nba/repo.js", async () => {
  const actual = await import("../src/modules/nba/repo.js");
  return {
    toView: actual.toView,
    findById: vi.fn(async () => null),
    listForProfile: (...a: unknown[]) => H.listForProfileMock(...a),
    insert: vi.fn(),
    updateStatus: vi.fn(async () => true),
  };
});

vi.mock("../src/modules/matrix/repo.js", async () => {
  const actual = await import("../src/modules/matrix/repo.js");
  return {
    toView: actual.toView,
    findById: vi.fn(async () => null),
    listByTenant: (...a: unknown[]) => H.matrixListMock(...a),
    findByProductPair: vi.fn(async () => []),
    insert: vi.fn(),
    update: vi.fn(async () => true),
    deleteById: vi.fn(async () => true),
  };
});

vi.mock("../src/modules/predictive/repo.js", async () => {
  const actual = await import("../src/modules/predictive/repo.js");
  return {
    toView: actual.toView,
    findBySubjectModel: (...a: unknown[]) => H.predictiveFindMock(...a),
    listBySubject: vi.fn(async () => []),
    listRanked: vi.fn(async () => ({ rows: [], total: 0 })),
    upsert: vi.fn(async () => []),
  };
});

import { buildApp } from "../src/app.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["recommendation_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });
const strangerAuth = () => auth(["viewer"]);

function makeMatrixEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "dddddddd-1111-4000-8000-000000000001",
    tenantId: TENANT,
    triggerProductId: PRODUCT_A,
    recommendedProductId: PRODUCT_B,
    segment: null,
    channel: null,
    priority: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    ...overrides,
  };
}

function makeRecommendation(overrides: Record<string, unknown> = {}) {
  return {
    id: "cccccccc-1111-4000-8000-000000000001",
    tenantId: TENANT,
    profileId: PROFILE_ID,
    recommendationType: "cross_sell",
    productId: PRODUCT_B,
    channel: "web",
    score: "0.8200",
    status: "served",
    servedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.cacheMakeKeyMock.mockReturnValue("cache-key");
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.listForProfileMock.mockResolvedValue({ rows: [], total: 0 });
  H.matrixListMock.mockResolvedValue({ rows: [], total: 0 });
  H.predictiveFindMock.mockResolvedValue(null);
});

// ── POST /v1/recommendations/nba/generate ─────────────────────────────────────

const generateUrl = "/v1/recommendations/nba/generate";

describe("POST /v1/recommendations/nba/generate", () => {
  it("200 — ranks explicit candidates with score and reason", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: {
        profileId: PROFILE_ID,
        candidates: [
          { id: "low", actionType: "upsell", signals: { affinity: 0.1 } },
          { id: "high", actionType: "cross_sell", signals: { affinity: 1 } },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    const data = r.json().data;
    expect(data.map((a: { id: string }) => a.id)).toEqual(["high", "low"]);
    expect(typeof data[0].score).toBe("number");
    expect(data[0].reason).toContain("affinity");
    await app.close();
  });

  it("200 — the same request yields the identical order every time", async () => {
    const payload = {
      profileId: PROFILE_ID,
      candidates: [
        { id: "c", actionType: "a", priority: 2, signals: { affinity: 0.5 } },
        { id: "a", actionType: "a", priority: 2, signals: { affinity: 0.5 } },
        { id: "b", actionType: "a", priority: 2, signals: { affinity: 0.5 } },
      ],
    };
    const app = await buildApp();
    const first = (await app.inject({ method: "POST", url: generateUrl, headers: auth(), payload }))
      .json()
      .data.map((a: { id: string }) => a.id);
    for (let i = 0; i < 5; i += 1) {
      const again = (await app.inject({ method: "POST", url: generateUrl, headers: auth(), payload }))
        .json()
        .data.map((a: { id: string }) => a.id);
      expect(again).toEqual(first);
    }
    // Full tie → the documented id-ascending tie-break.
    expect(first).toEqual(["a", "b", "c"]);
    await app.close();
  });

  it("200 — respects the limit", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: {
        profileId: PROFILE_ID,
        limit: 1,
        candidates: [
          { id: "a", actionType: "x", signals: { affinity: 0.2 } },
          { id: "b", actionType: "x", signals: { affinity: 0.9 } },
        ],
      },
    });
    expect(r.json().data).toHaveLength(1);
    expect(r.json().data[0].id).toBe("b");
    expect(r.json().meta.total).toBe(2);
    await app.close();
  });

  it("200 — defaults the limit to 5", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: { profileId: PROFILE_ID, candidates: [] },
    });
    expect(r.json().meta.pageSize).toBe(5);
    await app.close();
  });

  it("200 — filters out ineligible candidates", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: {
        profileId: PROFILE_ID,
        context: { channel: "web", hasConsent: false },
        candidates: [
          { id: "needs-consent", actionType: "x", signals: { affinity: 1 }, eligibility: { requiresConsent: true } },
          { id: "open", actionType: "x", signals: { affinity: 0.5 } },
        ],
      },
    });
    expect(r.json().data.map((a: { id: string }) => a.id)).toEqual(["open"]);
    expect(r.json().meta.candidateCount).toBe(2);
    expect(r.json().meta.eligibleCount).toBe(1);
    await app.close();
  });

  it("200 — returns an empty set when every candidate is ineligible", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: {
        profileId: PROFILE_ID,
        candidates: [
          { id: "off", actionType: "x", signals: { affinity: 1 }, eligibility: { suppressed: true } },
        ],
      },
    });
    expect(r.json().data).toEqual([]);
    expect(r.json().meta.eligibleCount).toBe(0);
    await app.close();
  });

  it("200 — returns an empty set for no candidates", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: { profileId: PROFILE_ID, candidates: [] },
    });
    expect(r.json().data).toEqual([]);
    expect(r.json().meta.candidateCount).toBe(0);
    await app.close();
  });

  it("200 — builds candidates from the cross-sell matrix when none are supplied", async () => {
    H.matrixListMock.mockResolvedValue({
      rows: [makeMatrixEntry({ id: "m1", priority: 10 }), makeMatrixEntry({ id: "m2", priority: 1 })],
      total: 2,
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: { profileId: PROFILE_ID },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.map((a: { id: string }) => a.id)).toEqual(["m1", "m2"]);
    expect(r.json().data[0].actionType).toBe("cross_sell");
    expect(r.json().data[0].productId).toBe(PRODUCT_B);
    await app.close();
  });

  it("200 — uses the renewal predictive score as the propensity signal", async () => {
    H.predictiveFindMock.mockResolvedValue({ score: "0.9000" });
    H.matrixListMock.mockResolvedValue({ rows: [makeMatrixEntry({ priority: 0 })], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: { profileId: PROFILE_ID },
    });
    const propensity = r
      .json()
      .data[0].contributions.find((c: { signal: string }) => c.signal === "propensity");
    expect(propensity.value).toBeCloseTo(0.9, 4);
    expect(H.predictiveFindMock).toHaveBeenCalledWith(TENANT, "profile", PROFILE_ID, "renewal");
    await app.close();
  });

  it("200 — a missing predictive score means propensity 0", async () => {
    H.matrixListMock.mockResolvedValue({ rows: [makeMatrixEntry()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: { profileId: PROFILE_ID },
    });
    const propensity = r
      .json()
      .data[0].contributions.find((c: { signal: string }) => c.signal === "propensity");
    expect(propensity.value).toBe(0);
    await app.close();
  });

  it("200 — an unparseable predictive score means propensity 0", async () => {
    H.predictiveFindMock.mockResolvedValue({ score: "not-a-number" });
    H.matrixListMock.mockResolvedValue({ rows: [makeMatrixEntry()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: { profileId: PROFILE_ID },
    });
    const propensity = r
      .json()
      .data[0].contributions.find((c: { signal: string }) => c.signal === "propensity");
    expect(propensity.value).toBe(0);
    await app.close();
  });

  it("200 — passes the context channel and segment to the matrix query", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: { profileId: PROFILE_ID, context: { channel: "mobile", segment: "sme" } },
    });
    expect(H.matrixListMock).toHaveBeenCalledWith(TENANT, 200, 0, {
      segment: "sme",
      channel: "mobile",
    });
    await app.close();
  });

  it("200 — honours custom weights", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: {
        profileId: PROFILE_ID,
        weights: { affinity: 0, propensity: 0, value: 0, urgency: 10 },
        candidates: [
          { id: "affinity", actionType: "x", signals: { affinity: 1 } },
          { id: "urgency", actionType: "x", signals: { urgency: 1 } },
        ],
      },
    });
    expect(r.json().data[0].id).toBe("urgency");
    await app.close();
  });

  it("400 — profileId missing", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: generateUrl, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — non-uuid profileId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: { profileId: "nope" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — limit above the maximum", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: { profileId: PROFILE_ID, limit: 500 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — a signal above 1", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: {
        profileId: PROFILE_ID,
        candidates: [{ id: "a", actionType: "x", signals: { affinity: 5 } }],
      },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — an unknown signal name", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: {
        profileId: PROFILE_ID,
        candidates: [{ id: "a", actionType: "x", signals: { luck: 1 } }],
      },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — a health score above 100 in the context", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: auth(),
      payload: { profileId: PROFILE_ID, context: { healthScore: 900 } },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      payload: { profileId: PROFILE_ID },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: generateUrl,
      headers: strangerAuth(),
      payload: { profileId: PROFILE_ID },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/recommendations/nba/:profileId/history ────────────────────────────

describe("GET /v1/recommendations/nba/:profileId/history", () => {
  const url = `/v1/recommendations/nba/${PROFILE_ID}/history`;

  it("200 — returns the paginated served log", async () => {
    H.listForProfileMock.mockResolvedValue({
      rows: [makeRecommendation(), makeRecommendation({ id: "other", status: "rejected" })],
      total: 2,
    });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(2);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 20, total: 2 });
    await app.close();
  });

  it("200 — includes terminal rows by default (no status filter)", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url, headers: auth() });
    expect(H.listForProfileMock).toHaveBeenCalledWith(TENANT, PROFILE_ID, 20, 0, {});
    await app.close();
  });

  it("200 — filters by status when asked", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: `${url}?status=accepted`, headers: auth() });
    expect(H.listForProfileMock).toHaveBeenCalledWith(TENANT, PROFILE_ID, 20, 0, {
      statuses: ["accepted"],
    });
    await app.close();
  });

  it("200 — computes the page from the offset", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?limit=10&offset=20`, headers: auth() });
    expect(r.json().meta.page).toBe(3);
    await app.close();
  });

  it("200 — empty history", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.json().data).toEqual([]);
    await app.close();
  });

  it("400 — non-uuid profileId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/nba/nope/history",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — limit above the maximum", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?limit=500`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — unknown status filter", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?status=archived`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: strangerAuth() });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
