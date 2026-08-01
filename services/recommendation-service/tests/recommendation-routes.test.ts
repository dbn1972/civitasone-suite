/**
 * recommendation-service route-level tests — nba, matrix, health, feedback.
 * Happy paths + 400 (zod) / 401 / 403 / 404 / 409 / 422. Fully mocked: no DB.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const REC_ID = "cccccccc-1111-4000-8000-000000000001";
const MATRIX_ID = "dddddddd-1111-4000-8000-000000000001";
const ACCOUNT_ID = "eeeeeeee-1111-4000-8000-000000000001";
const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";
const FEEDBACK_ID = "ffffffff-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  scopedReadMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  enqueueMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
  nbaFindByIdMock: vi.fn(),
  nbaListForProfileMock: vi.fn(),
  nbaInsertMock: vi.fn(),
  nbaUpdateStatusMock: vi.fn(),
  matrixFindByIdMock: vi.fn(),
  matrixListMock: vi.fn(),
  matrixFindByProductPairMock: vi.fn(),
  matrixInsertMock: vi.fn(),
  matrixUpdateMock: vi.fn(),
  matrixDeleteMock: vi.fn(),
  healthFindLatestMock: vi.fn(),
  healthListHistoryMock: vi.fn(),
  healthInsertMock: vi.fn(),
  healthFindByIdMock: vi.fn(),
  healthUpdateMock: vi.fn(),
  feedbackInsertMock: vi.fn(),
  feedbackListMock: vi.fn(),
  feedbackFindByIdMock: vi.fn(),
  feedbackUpdateMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (...a: unknown[]) => H.cacheMakeKeyMock(...a),
  },
  queue: { publish: vi.fn() },
}));

vi.mock("../src/modules/nba/repo.js", () => ({
  findById: (...a: unknown[]) => H.nbaFindByIdMock(...a),
  listForProfile: (...a: unknown[]) => H.nbaListForProfileMock(...a),
  insert: (...a: unknown[]) => H.nbaInsertMock(...a),
  updateStatus: (...a: unknown[]) => H.nbaUpdateStatusMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/matrix/repo.js", () => ({
  findById: (...a: unknown[]) => H.matrixFindByIdMock(...a),
  listByTenant: (...a: unknown[]) => H.matrixListMock(...a),
  findByProductPair: (...a: unknown[]) => H.matrixFindByProductPairMock(...a),
  insert: (...a: unknown[]) => H.matrixInsertMock(...a),
  update: (...a: unknown[]) => H.matrixUpdateMock(...a),
  deleteById: (...a: unknown[]) => H.matrixDeleteMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/health/repo.js", () => ({
  findById: (...a: unknown[]) => H.healthFindByIdMock(...a),
  findLatestByAccount: (...a: unknown[]) => H.healthFindLatestMock(...a),
  listHistory: (...a: unknown[]) => H.healthListHistoryMock(...a),
  insert: (...a: unknown[]) => H.healthInsertMock(...a),
  update: (...a: unknown[]) => H.healthUpdateMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/feedback/repo.js", () => ({
  findById: (...a: unknown[]) => H.feedbackFindByIdMock(...a),
  listByRecommendation: (...a: unknown[]) => H.feedbackListMock(...a),
  insert: (...a: unknown[]) => H.feedbackInsertMock(...a),
  update: (...a: unknown[]) => H.feedbackUpdateMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["recommendation_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["recommendation_admin"]) => ({
  authorization: `Bearer ${tok(sub, roles)}`,
});
const readerAuth = () => auth(USER, ["crm_user"]);
const strangerAuth = () => auth(USER, ["viewer"]);

function makeRecommendation(overrides: Record<string, unknown> = {}) {
  return {
    id: REC_ID,
    tenantId: TENANT,
    profileId: PROFILE_ID,
    recommendationType: "cross_sell",
    productId: PRODUCT_B,
    channel: "web",
    score: 0.82,
    status: "served",
    servedAt: new Date(Date.now() - 3_600_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    ...overrides,
  };
}

function makeMatrixEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: MATRIX_ID,
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

function makeHealthScore(overrides: Record<string, unknown> = {}) {
  return {
    id: "99999999-1111-4000-8000-000000000001",
    tenantId: TENANT,
    accountId: ACCOUNT_ID,
    score: 72,
    factors: { recency: 80, frequency: 70 },
    computedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
    ...overrides,
  };
}

function makeFeedback(overrides: Record<string, unknown> = {}) {
  return {
    id: FEEDBACK_ID,
    tenantId: TENANT,
    recommendationId: REC_ID,
    action: "rejected",
    reason: "already owns product",
    recordedAt: new Date(),
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
  H.enqueueMock.mockResolvedValue(undefined);
  H.nbaInsertMock.mockResolvedValue(undefined);
  H.nbaUpdateStatusMock.mockResolvedValue(true);
  H.nbaListForProfileMock.mockResolvedValue({ rows: [], total: 0 });
  H.matrixInsertMock.mockResolvedValue(undefined);
  H.matrixUpdateMock.mockResolvedValue(true);
  H.matrixDeleteMock.mockResolvedValue(true);
  H.matrixFindByProductPairMock.mockResolvedValue([]);
  H.matrixListMock.mockResolvedValue({ rows: [], total: 0 });
  H.healthInsertMock.mockResolvedValue(undefined);
  H.healthListHistoryMock.mockResolvedValue({ rows: [], total: 0 });
  H.feedbackInsertMock.mockResolvedValue(undefined);
  H.feedbackListMock.mockResolvedValue({ rows: [], total: 0 });
});

// ── GET /v1/recommendations/:profileId ────────────────────────────────────────

describe("GET /v1/recommendations/:profileId", () => {
  it("200 — returns ranked recommendations with pagination meta", async () => {
    H.nbaListForProfileMock.mockResolvedValue({
      rows: [makeRecommendation({ id: REC_ID, score: 0.4 }), makeRecommendation({ id: MATRIX_ID, score: 0.9 })],
      total: 2,
    });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/recommendations/${PROFILE_ID}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(2);
    expect(r.json().data[0].score).toBe(0.9);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 5, total: 2 });
    await app.close();
  });

  it("200 — caps the result at the requested limit", async () => {
    H.nbaListForProfileMock.mockResolvedValue({
      rows: [makeRecommendation({ score: 0.4 }), makeRecommendation({ score: 0.9 })],
      total: 2,
    });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/recommendations/${PROFILE_ID}?limit=1`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("200 — excludes terminal statuses and expired rows via repo filters", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/recommendations/${PROFILE_ID}`, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    const filters = H.nbaListForProfileMock.mock.calls[0]?.[4] as Record<string, unknown>;
    expect(filters.statuses).toEqual(["served"]);
    expect(filters.servedAfter).toBeInstanceOf(Date);
    await app.close();
  });

  it("200 — passes the channel filter through", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/${PROFILE_ID}?channel=mobile`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const filters = H.nbaListForProfileMock.mock.calls[0]?.[4] as Record<string, unknown>;
    expect(filters.channel).toBe("mobile");
    await app.close();
  });

  it("200 — computes the page number from the offset", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/${PROFILE_ID}?limit=5&offset=10`,
      headers: auth(),
    });
    expect(r.json().meta.page).toBe(3);
    await app.close();
  });

  it("400 — non-uuid profileId", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/recommendations/not-a-uuid", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — limit above the maximum", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/${PROFILE_ID}?limit=500`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/recommendations/${PROFILE_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/${PROFILE_ID}`,
      headers: strangerAuth(),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/recommendations/detail/:id ────────────────────────────────────────

describe("GET /v1/recommendations/detail/:id", () => {
  it("200 — returns the recommendation", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(makeRecommendation());
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/recommendations/detail/${REC_ID}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.id).toBe(REC_ID);
    await app.close();
  });

  it("404 — recommendation missing", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/recommendations/detail/${REC_ID}`, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — non-uuid id", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/recommendations/detail/xyz", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/recommendations/detail/${REC_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/detail/${REC_ID}`,
      headers: strangerAuth(),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── POST /v1/recommendations ──────────────────────────────────────────────────

describe("POST /v1/recommendations", () => {
  it("201 — creates a served recommendation with an explicit score", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations",
      headers: auth(),
      payload: { profileId: PROFILE_ID, recommendationType: "cross_sell", score: 0.75 },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.score).toBe(0.75);
    expect(r.json().data.status).toBe("served");
    expect(H.nbaInsertMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("201 — derives the score from signals when none is supplied", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations",
      headers: auth(),
      payload: {
        profileId: PROFILE_ID,
        recommendationType: "cross_sell",
        signals: { matrixPriority: 10, healthScore: 100, affinity: 1 },
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.score).toBe(1);
    await app.close();
  });

  it("201 — defaults score to 0 without signals", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations",
      headers: auth(),
      payload: { profileId: PROFILE_ID, recommendationType: "upsell", channel: "web", productId: PRODUCT_B },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.score).toBe(0);
    expect(r.json().data.channel).toBe("web");
    await app.close();
  });

  it("400 — missing profileId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations",
      headers: auth(),
      payload: { recommendationType: "cross_sell" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — score above 1", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations",
      headers: auth(),
      payload: { profileId: PROFILE_ID, recommendationType: "cross_sell", score: 5 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations",
      payload: { profileId: PROFILE_ID, recommendationType: "cross_sell" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — read-only role cannot create", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations",
      headers: readerAuth(),
      payload: { profileId: PROFILE_ID, recommendationType: "cross_sell" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── POST /v1/recommendations/:id/accept ───────────────────────────────────────

describe("POST /v1/recommendations/:id/accept", () => {
  it("200 — accepts a served recommendation", async () => {
    H.nbaFindByIdMock.mockResolvedValue(makeRecommendation());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/accept`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("accepted");
    expect(r.json().data.version).toBe(2);
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("200 — honours an explicit version in the body", async () => {
    H.nbaFindByIdMock.mockResolvedValue(makeRecommendation({ version: 4 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/accept`,
      headers: auth(),
      payload: { version: 4 },
    });
    expect(r.statusCode).toBe(200);
    expect(H.nbaUpdateStatusMock).toHaveBeenCalledWith(expect.anything(), REC_ID, TENANT, expect.anything(), 4);
    await app.close();
  });

  it("404 — recommendation missing", async () => {
    H.nbaFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/accept`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — already accepted (invalid transition)", async () => {
    H.nbaFindByIdMock.mockResolvedValue(makeRecommendation({ status: "accepted" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/accept`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_TRANSITION");
    await app.close();
  });

  it("422 — recommendation past its TTL", async () => {
    H.nbaFindByIdMock.mockResolvedValue(
      makeRecommendation({ servedAt: new Date(Date.now() - 500 * 3_600_000) }),
    );
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/accept`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("RECOMMENDATION_EXPIRED");
    await app.close();
  });

  it("409 — version conflict", async () => {
    H.nbaFindByIdMock.mockResolvedValue(makeRecommendation());
    H.nbaUpdateStatusMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/accept`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("400 — non-uuid id", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/recommendations/abc/accept", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/recommendations/${REC_ID}/accept` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/accept`,
      headers: strangerAuth(),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── POST /v1/recommendations/:id/reject ───────────────────────────────────────

/**
 * CR-AI-03 tightened this endpoint: a rejection now requires a structured
 * `reasonCode`, so the payloads below carry one. The free-text-only form that
 * used to be accepted is now a 400 REASON_REQUIRED — asserted in
 * tests/rejection-feedback.test.ts along with the rest of the new contract.
 */
describe("POST /v1/recommendations/:id/reject", () => {
  it("200 — rejects with a structured reason code", async () => {
    H.nbaFindByIdMock.mockResolvedValue(makeRecommendation());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/reject`,
      headers: auth(),
      payload: { reasonCode: "customer_declined", reasonText: "customer not interested" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.status).toBe("rejected");
    await app.close();
  });

  it("400 — reason missing", async () => {
    H.nbaFindByIdMock.mockResolvedValue(makeRecommendation());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/reject`,
      headers: auth(),
      payload: {},
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("REASON_REQUIRED");
    await app.close();
  });

  it("400 — reason code empty", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/reject`,
      headers: auth(),
      payload: { reasonCode: "" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — recommendation missing", async () => {
    H.nbaFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/reject`,
      headers: auth(),
      payload: { reasonCode: "not_relevant" },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — already rejected (invalid transition)", async () => {
    H.nbaFindByIdMock.mockResolvedValue(makeRecommendation({ status: "rejected" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/reject`,
      headers: auth(),
      payload: { reasonCode: "not_relevant" },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("409 — version conflict", async () => {
    H.nbaFindByIdMock.mockResolvedValue(makeRecommendation());
    H.nbaUpdateStatusMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/reject`,
      headers: auth(),
      payload: { reasonCode: "not_relevant" },
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/reject`,
      payload: { reasonCode: "not_relevant" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${REC_ID}/reject`,
      headers: strangerAuth(),
      payload: { reasonCode: "not_relevant" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/recommendations/matrix ────────────────────────────────────────────

describe("GET /v1/recommendations/matrix", () => {
  it("200 — returns a paginated list", async () => {
    H.matrixListMock.mockResolvedValue({ rows: [makeMatrixEntry()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/recommendations/matrix", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    await app.close();
  });

  it("200 — applies triggerProductId, segment and channel filters", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/matrix?triggerProductId=${PRODUCT_A}&segment=sme&channel=web`,
      headers: readerAuth(),
    });
    expect(r.statusCode).toBe(200);
    expect(H.matrixListMock).toHaveBeenCalledWith(TENANT, 20, 0, {
      triggerProductId: PRODUCT_A,
      segment: "sme",
      channel: "web",
    });
    await app.close();
  });

  it("400 — non-uuid triggerProductId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/matrix?triggerProductId=nope",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/recommendations/matrix" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/recommendations/matrix", headers: strangerAuth() });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/recommendations/matrix/:id ────────────────────────────────────────

describe("GET /v1/recommendations/matrix/:id", () => {
  it("200 — returns the entry", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(makeMatrixEntry());
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.priority).toBe(5);
    await app.close();
  });

  it("404 — entry missing", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — non-uuid id", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/recommendations/matrix/oops", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/recommendations/matrix/${MATRIX_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      headers: strangerAuth(),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── POST /v1/recommendations/matrix ───────────────────────────────────────────

describe("POST /v1/recommendations/matrix", () => {
  it("201 — creates a matrix entry", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/matrix",
      headers: auth(),
      payload: { triggerProductId: PRODUCT_A, recommendedProductId: PRODUCT_B, priority: 3, segment: "sme" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.priority).toBe(3);
    expect(H.matrixInsertMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("201 — defaults priority to 0", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/matrix",
      headers: auth(),
      payload: { triggerProductId: PRODUCT_A, recommendedProductId: PRODUCT_B },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.priority).toBe(0);
    await app.close();
  });

  it("422 — trigger and recommended product are the same", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/matrix",
      headers: auth(),
      payload: { triggerProductId: PRODUCT_A, recommendedProductId: PRODUCT_A },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("MATRIX_INVALID");
    await app.close();
  });

  it("409 — duplicate scope", async () => {
    H.matrixFindByProductPairMock.mockResolvedValue([makeMatrixEntry()]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/matrix",
      headers: auth(),
      payload: { triggerProductId: PRODUCT_A, recommendedProductId: PRODUCT_B },
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("MATRIX_DUPLICATE");
    await app.close();
  });

  it("201 — a different segment is not a duplicate", async () => {
    H.matrixFindByProductPairMock.mockResolvedValue([makeMatrixEntry({ segment: "retail" })]);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/matrix",
      headers: auth(),
      payload: { triggerProductId: PRODUCT_A, recommendedProductId: PRODUCT_B, segment: "sme" },
    });
    expect(r.statusCode).toBe(201);
    await app.close();
  });

  it("400 — negative priority", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/matrix",
      headers: auth(),
      payload: { triggerProductId: PRODUCT_A, recommendedProductId: PRODUCT_B, priority: -2 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/matrix",
      payload: { triggerProductId: PRODUCT_A, recommendedProductId: PRODUCT_B },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — read-only role cannot create", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/matrix",
      headers: readerAuth(),
      payload: { triggerProductId: PRODUCT_A, recommendedProductId: PRODUCT_B },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── PATCH /v1/recommendations/matrix/:id ──────────────────────────────────────

describe("PATCH /v1/recommendations/matrix/:id", () => {
  it("200 — updates priority", async () => {
    H.matrixFindByIdMock.mockResolvedValue(makeMatrixEntry());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      headers: auth(),
      payload: { priority: 9, version: 1 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.version).toBe(2);
    expect(H.matrixUpdateMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("200 — updates segment and channel", async () => {
    H.matrixFindByIdMock.mockResolvedValue(makeMatrixEntry());
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      headers: auth(),
      payload: { segment: "sme", channel: "mobile", version: 1 },
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("404 — entry missing", async () => {
    H.matrixFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      headers: auth(),
      payload: { priority: 2, version: 1 },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — version conflict", async () => {
    H.matrixFindByIdMock.mockResolvedValue(makeMatrixEntry());
    H.matrixUpdateMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      headers: auth(),
      payload: { priority: 2, version: 1 },
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("422 — patch would make trigger and recommended product match", async () => {
    H.matrixFindByIdMock.mockResolvedValue(makeMatrixEntry({ recommendedProductId: PRODUCT_A }));
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      headers: auth(),
      payload: { priority: 2, version: 1 },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("400 — version missing", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      headers: auth(),
      payload: { priority: 2 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      payload: { priority: 2, version: 1 },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — read-only role cannot update", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      headers: readerAuth(),
      payload: { priority: 2, version: 1 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── DELETE /v1/recommendations/matrix/:id ─────────────────────────────────────

describe("DELETE /v1/recommendations/matrix/:id", () => {
  it("200 — deletes the entry", async () => {
    H.matrixFindByIdMock.mockResolvedValue(makeMatrixEntry());
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.deleted).toBe(true);
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("404 — entry missing", async () => {
    H.matrixFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("404 — entry vanished between read and delete", async () => {
    H.matrixFindByIdMock.mockResolvedValue(makeMatrixEntry());
    H.matrixDeleteMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — non-uuid id", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url: "/v1/recommendations/matrix/bad", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url: `/v1/recommendations/matrix/${MATRIX_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — read-only role cannot delete", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE",
      url: `/v1/recommendations/matrix/${MATRIX_ID}`,
      headers: readerAuth(),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/recommendations/health/:accountId ─────────────────────────────────

describe("GET /v1/recommendations/health/:accountId", () => {
  it("200 — returns the latest score with a classification", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(makeHealthScore({ score: 85 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/health/${ACCOUNT_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.score).toBe(85);
    expect(r.json().data.classification).toBe("excellent");
    await app.close();
  });

  it("200 — classifies a low score as critical", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(makeHealthScore({ score: 12 }));
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/health/${ACCOUNT_ID}`,
      headers: readerAuth(),
    });
    expect(r.json().data.classification).toBe("critical");
    await app.close();
  });

  it("404 — no score computed yet", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/health/${ACCOUNT_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — non-uuid accountId", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/recommendations/health/nope", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/recommendations/health/${ACCOUNT_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/health/${ACCOUNT_ID}`,
      headers: strangerAuth(),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/recommendations/health/:accountId/history ──────────────────────────

describe("GET /v1/recommendations/health/:accountId/history", () => {
  it("200 — returns paginated history", async () => {
    H.healthListHistoryMock.mockResolvedValue({ rows: [makeHealthScore(), makeHealthScore({ score: 40 })], total: 2 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/history`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(2);
    expect(r.json().data[1].classification).toBe("at_risk");
    expect(r.json().meta).toEqual({ page: 1, pageSize: 20, total: 2 });
    await app.close();
  });

  it("200 — honours limit and offset", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/history?limit=5&offset=5`,
      headers: readerAuth(),
    });
    expect(r.statusCode).toBe(200);
    expect(H.healthListHistoryMock).toHaveBeenCalledWith(TENANT, ACCOUNT_ID, 5, 5);
    expect(r.json().meta.page).toBe(2);
    await app.close();
  });

  it("400 — limit above the maximum", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/history?limit=9000`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/recommendations/health/${ACCOUNT_ID}/history` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/history`,
      headers: strangerAuth(),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── POST /v1/recommendations/health/:accountId/recompute ───────────────────────

describe("POST /v1/recommendations/health/:accountId/recompute", () => {
  it("201 — computes, persists and emits the score", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/recompute`,
      headers: auth(),
      payload: {
        factors: { recency: 100, frequency: 100, monetary: 100, supportTickets: 100, engagement: 100 },
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.score).toBe(100);
    expect(r.json().data.classification).toBe("excellent");
    expect(H.healthInsertMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("201 — partial factors produce a weighted score", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/recompute`,
      headers: auth(),
      payload: { factors: { recency: 100 } },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.score).toBe(25);
    expect(r.json().data.classification).toBe("critical");
    await app.close();
  });

  it("422 — no factors supplied", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/recompute`,
      headers: auth(),
      payload: { factors: {} },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("FACTORS_INVALID");
    await app.close();
  });

  it("400 — factor out of range", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/recompute`,
      headers: auth(),
      payload: { factors: { recency: 500 } },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — unknown factor name", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/recompute`,
      headers: auth(),
      payload: { factors: { churnRisk: 10 } },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — factors missing entirely", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/recompute`,
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
      url: `/v1/recommendations/health/${ACCOUNT_ID}/recompute`,
      payload: { factors: { recency: 50 } },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — read-only role cannot recompute", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/recompute`,
      headers: readerAuth(),
      payload: { factors: { recency: 50 } },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── POST /v1/recommendations/feedback ─────────────────────────────────────────

describe("POST /v1/recommendations/feedback", () => {
  it("201 — records an acceptance", async () => {
    H.nbaFindByIdMock.mockResolvedValue(makeRecommendation());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/feedback",
      headers: auth(),
      payload: { recommendationId: REC_ID, action: "accepted" },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.action).toBe("accepted");
    expect(r.json().data.reason).toBeNull();
    expect(H.feedbackInsertMock).toHaveBeenCalledOnce();
    expect(H.nbaUpdateStatusMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("201 — records a rejection with a reason", async () => {
    H.nbaFindByIdMock.mockResolvedValue(makeRecommendation());
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/feedback",
      headers: readerAuth(),
      payload: { recommendationId: REC_ID, action: "rejected", reason: "  already owns product  " },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().data.reason).toBe("already owns product");
    await app.close();
  });

  it("422 — rejection without a reason", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/feedback",
      headers: auth(),
      payload: { recommendationId: REC_ID, action: "rejected" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("FEEDBACK_INVALID");
    expect(H.feedbackInsertMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("422 — rejection with a blank reason", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/feedback",
      headers: auth(),
      payload: { recommendationId: REC_ID, action: "rejected", reason: "   " },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("404 — recommendation missing", async () => {
    H.nbaFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/feedback",
      headers: auth(),
      payload: { recommendationId: REC_ID, action: "accepted" },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — recommendation already in a terminal state", async () => {
    H.nbaFindByIdMock.mockResolvedValue(makeRecommendation({ status: "accepted" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/feedback",
      headers: auth(),
      payload: { recommendationId: REC_ID, action: "accepted" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_TRANSITION");
    await app.close();
  });

  it("409 — version conflict on the recommendation", async () => {
    H.nbaFindByIdMock.mockResolvedValue(makeRecommendation());
    H.nbaUpdateStatusMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/feedback",
      headers: auth(),
      payload: { recommendationId: REC_ID, action: "accepted" },
    });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("400 — unknown action", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/feedback",
      headers: auth(),
      payload: { recommendationId: REC_ID, action: "snoozed" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — non-uuid recommendationId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/feedback",
      headers: auth(),
      payload: { recommendationId: "nope", action: "accepted" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/feedback",
      payload: { recommendationId: REC_ID, action: "accepted" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/feedback",
      headers: strangerAuth(),
      payload: { recommendationId: REC_ID, action: "accepted" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/recommendations/feedback ──────────────────────────────────────────

describe("GET /v1/recommendations/feedback", () => {
  it("200 — lists feedback for a recommendation", async () => {
    H.feedbackListMock.mockResolvedValue({ rows: [makeFeedback()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/feedback?recommendationId=${REC_ID}`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    await app.close();
  });

  it("200 — honours limit and offset", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/feedback?recommendationId=${REC_ID}&limit=10&offset=20`,
      headers: readerAuth(),
    });
    expect(r.statusCode).toBe(200);
    expect(H.feedbackListMock).toHaveBeenCalledWith(TENANT, REC_ID, 10, 20);
    expect(r.json().meta.page).toBe(3);
    await app.close();
  });

  it("400 — recommendationId missing", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/recommendations/feedback", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/feedback?recommendationId=${REC_ID}`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/feedback?recommendationId=${REC_ID}`,
      headers: strangerAuth(),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
