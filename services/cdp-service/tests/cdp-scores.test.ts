/**
 * CDP-009 — predictive scores on a profile.
 * The load-bearing assertion is that a numeric(6,4) score stays a STRING end to end.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { toStoredScore } from "../src/modules/profiles/scores-routes.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const SCORE_ID = "eeeeeeee-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  profileFindByIdMock: vi.fn(),
  findByTypeMock: vi.fn(),
  listByProfileMock: vi.fn(),
  insertMock: vi.fn(),
  updateScoreMock: vi.fn(),
  enqueueMock: vi.fn(),
  publishMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({ enqueue: (...a: unknown[]) => H.enqueueMock(...a) }));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn(),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (t: string, r: string, i: string) => `cdp:${t}:${r}:${i}`,
  },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));

vi.mock("../src/modules/profiles/repo.js", () => ({
  findById: (...a: unknown[]) => H.profileFindByIdMock(...a),
  listByTenant: vi.fn(async () => ({ rows: [], total: 0 })),
  insert: vi.fn(),
  update: vi.fn(),
  markMerged: vi.fn(),
  findByIds: vi.fn(async () => []),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/profiles/scores-repo.js", async (orig) => {
  const actual = await orig<typeof import("../src/modules/profiles/scores-repo.js")>();
  return {
    ...actual,
    findByType: (...a: unknown[]) => H.findByTypeMock(...a),
    listByProfile: (...a: unknown[]) => H.listByProfileMock(...a),
    countByProfile: vi.fn(async () => 0),
    insert: (...a: unknown[]) => H.insertMock(...a),
    updateScore: (...a: unknown[]) => H.updateScoreMock(...a),
  };
});

const { buildApp } = await import("../src/app.js");

const auth = (roles = ["cdp_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

function makeProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID, tenantId: TENANT, profileType: "individual", attributes: {},
    sourceLineage: [], mergedFromIds: [], version: 1,
    createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER,
    ...overrides,
  };
}

function makeScore(overrides: Record<string, unknown> = {}) {
  return {
    id: SCORE_ID, tenantId: TENANT, profileId: PROFILE_ID, scoreType: "churn_risk",
    // postgres-js hands numeric back as text — the repo and route keep it that way.
    score: "0.8125", modelVersion: "churn-v3", computedAt: new Date("2025-05-01T00:00:00Z"), version: 4,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.enqueueMock.mockResolvedValue(undefined);
  H.publishMock.mockResolvedValue("m");
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.insertMock.mockResolvedValue(undefined);
  H.updateScoreMock.mockResolvedValue(true);
  H.findByTypeMock.mockResolvedValue(null);
  H.listByProfileMock.mockResolvedValue({ rows: [], total: 0 });
  H.profileFindByIdMock.mockResolvedValue(makeProfile());
});

// ── PURE: toStoredScore ───────────────────────────────────────────────────────

describe("toStoredScore", () => {
  it("normalises to exactly four decimal places", () => {
    expect(toStoredScore(0.5)).toBe("0.5000");
    expect(toStoredScore(0)).toBe("0.0000");
    expect(toStoredScore(1)).toBe("1.0000");
  });

  it("rounds a longer fraction rather than letting Postgres do it silently", () => {
    expect(toStoredScore(0.123456)).toBe("0.1235");
  });

  it("keeps the value a string so no float creeps back in", () => {
    expect(typeof toStoredScore(0.1 + 0.2)).toBe("string");
    expect(toStoredScore(0.1 + 0.2)).toBe("0.3000");
  });
});

describe("PUT /v1/cdp/profiles/:id/scores/:scoreType", () => {
  const url = `/v1/cdp/profiles/${PROFILE_ID}/scores/churn_risk`;

  it("200 — creates a score when none exists", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT", url, headers: auth(), payload: { score: 0.8125, modelVersion: "churn-v3" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.created).toBe(true);
    // A string, not a number — 0.8125 must survive verbatim.
    expect(r.json().data.score).toBe("0.8125");
    expect(typeof r.json().data.score).toBe("string");
    expect(H.insertMock).toHaveBeenCalledOnce();
    expect(H.cacheInvalidateMock).toHaveBeenCalledWith(`cdp:${TENANT}:profile_summary:${PROFILE_ID}`);
    await app.close();
  });

  it("200 — upserts over an existing score under its current version", async () => {
    H.findByTypeMock.mockResolvedValue(makeScore());
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT", url, headers: auth(), payload: { score: 0.42, modelVersion: "churn-v4" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.created).toBe(false);
    expect(r.json().data.id).toBe(SCORE_ID);
    expect(H.insertMock).not.toHaveBeenCalled();
    expect(H.updateScoreMock).toHaveBeenCalledWith({}, SCORE_ID, TENANT, 4, expect.objectContaining({ score: "0.4200" }));
    await app.close();
  });

  it("200 — ml_service may write scores", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT", url, headers: auth(["ml_service"]), payload: { score: 0.1 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.modelVersion).toBe("unknown");
    await app.close();
  });

  it("400 — negative score", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PUT", url, headers: auth(), payload: { score: -0.1 } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — score is not a number", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PUT", url, headers: auth(), payload: { score: "0.5" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — scoreType is not lower_snake_case", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT", url: `/v1/cdp/profiles/${PROFILE_ID}/scores/ChurnRisk`, headers: auth(),
      payload: { score: 0.5 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown profile", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "PUT", url, headers: auth(), payload: { score: 0.5 } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("409 — a concurrent retrain already moved the row on", async () => {
    H.findByTypeMock.mockResolvedValue(makeScore());
    H.updateScoreMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({ method: "PUT", url, headers: auth(), payload: { score: 0.5 } });
    expect(r.statusCode).toBe(409);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PUT", url, payload: { score: 0.5 } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a read-only cdp user cannot write scores", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PUT", url, headers: auth(["cdp_user"]), payload: { score: 0.5 } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/cdp/profiles/:id/scores", () => {
  const url = `/v1/cdp/profiles/${PROFILE_ID}/scores`;

  it("200 — returns scores as strings inside the list envelope", async () => {
    H.listByProfileMock.mockResolvedValue({
      rows: [makeScore(), makeScore({ id: "eeeeeeee-2222-4000-8000-000000000002", scoreType: "clv_band", score: "12.5000" })],
      total: 2,
    });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    const data = r.json().data as Array<{ score: unknown; scoreType: string }>;
    expect(data.map((s) => s.score)).toEqual(["0.8125", "12.5000"]);
    expect(data.every((s) => typeof s.score === "string")).toBe(true);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 50, total: 2 });
    await app.close();
  });

  it("200 — empty envelope for a profile with no scores", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]);
    await app.close();
  });

  it("400 — limit above the 200 cap", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?limit=201`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 — unknown profile", async () => {
    H.profileFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — role without cdp access", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth(["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
