/**
 * KA-004 — health/scoring-domain unit tests plus the two new banded endpoints.
 * Every band boundary (25/26, 50/51, 75/76) and the clamping behaviour are
 * covered explicitly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  AT_RISK_BANDS,
  BAND_UPPER_BOUNDS,
  HEALTH_BANDS,
  HEALTH_SIGNAL_NAMES,
  SIGNAL_WEIGHTS,
  bandOf,
  computeHealthScore,
  isAtRiskBand,
  type HealthSignals,
} from "../src/modules/health/scoring-domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const ACCOUNT_ID = "eeeeeeee-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  scopedReadMock: vi.fn(),
  dbTransactionMock: vi.fn(),
  enqueueMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
  listAtRiskMock: vi.fn(),
  findCurrentMock: vi.fn(),
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

vi.mock("../src/modules/health/scoring-repo.js", () => ({
  listAtRisk: (...a: unknown[]) => H.listAtRiskMock(...a),
  findCurrent: (...a: unknown[]) => H.findCurrentMock(...a),
}));

import { buildApp } from "../src/app.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["recommendation_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });
const strangerAuth = () => auth(["viewer"]);

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.cacheMakeKeyMock.mockReturnValue("cache-key");
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.listAtRiskMock.mockResolvedValue({ rows: [], total: 0 });
});

// ── bandOf: every boundary ────────────────────────────────────────────────────

describe("bandOf band boundaries", () => {
  it("lists exactly four bands", () => {
    expect(HEALTH_BANDS).toEqual(["critical", "at_risk", "healthy", "thriving"]);
  });

  it("declares the documented upper bounds", () => {
    expect(BAND_UPPER_BOUNDS).toEqual({ critical: 25, at_risk: 50, healthy: 75, thriving: 100 });
  });

  it("0 is critical", () => {
    expect(bandOf(0)).toBe("critical");
  });

  it("25 is critical (upper boundary of critical)", () => {
    expect(bandOf(25)).toBe("critical");
  });

  it("26 is at_risk (lower boundary of at_risk)", () => {
    expect(bandOf(26)).toBe("at_risk");
  });

  it("50 is at_risk (upper boundary of at_risk)", () => {
    expect(bandOf(50)).toBe("at_risk");
  });

  it("51 is healthy (lower boundary of healthy)", () => {
    expect(bandOf(51)).toBe("healthy");
  });

  it("75 is healthy (upper boundary of healthy)", () => {
    expect(bandOf(75)).toBe("healthy");
  });

  it("76 is thriving (lower boundary of thriving)", () => {
    expect(bandOf(76)).toBe("thriving");
  });

  it("100 is thriving", () => {
    expect(bandOf(100)).toBe("thriving");
  });

  it("clamps above 100 to thriving", () => {
    expect(bandOf(1000)).toBe("thriving");
  });

  it("clamps below 0 to critical", () => {
    expect(bandOf(-50)).toBe("critical");
  });

  it("treats NaN as critical", () => {
    expect(bandOf(NaN)).toBe("critical");
  });

  it("treats Infinity as thriving", () => {
    expect(bandOf(Infinity)).toBe("thriving");
  });

  it("treats -Infinity as critical", () => {
    expect(bandOf(-Infinity)).toBe("critical");
  });
});

describe("isAtRiskBand", () => {
  it("critical and at_risk are on the watchlist", () => {
    expect(AT_RISK_BANDS).toEqual(["critical", "at_risk"]);
    expect(isAtRiskBand("critical")).toBe(true);
    expect(isAtRiskBand("at_risk")).toBe(true);
  });

  it("healthy and thriving are not", () => {
    expect(isAtRiskBand("healthy")).toBe(false);
    expect(isAtRiskBand("thriving")).toBe(false);
  });

  it("an unknown band is not on the watchlist", () => {
    expect(isAtRiskBand("unknown")).toBe(false);
  });
});

// ── computeHealthScore ────────────────────────────────────────────────────────

describe("computeHealthScore", () => {
  const perfect: HealthSignals = {
    productUsage: 100,
    engagement: 100,
    supportBurden: 100,
    paymentTimeliness: 100,
    relationshipDepth: 100,
  };

  it("signal weights sum to 1", () => {
    const total = HEALTH_SIGNAL_NAMES.reduce((sum, name) => sum + SIGNAL_WEIGHTS[name], 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("returns 100/thriving when every signal is perfect", () => {
    const result = computeHealthScore(perfect);
    expect(result.score).toBe(100);
    expect(result.band).toBe("thriving");
  });

  it("returns 0/critical for an empty signal bundle", () => {
    const result = computeHealthScore({});
    expect(result.score).toBe(0);
    expect(result.band).toBe("critical");
  });

  it("returns 0/critical when every signal is zero", () => {
    const result = computeHealthScore({
      productUsage: 0,
      engagement: 0,
      supportBurden: 0,
      paymentTimeliness: 0,
      relationshipDepth: 0,
    });
    expect(result.score).toBe(0);
    expect(result.band).toBe("critical");
  });

  it("applies each signal's declared weight in isolation", () => {
    for (const name of HEALTH_SIGNAL_NAMES) {
      const result = computeHealthScore({ [name]: 100 } as HealthSignals);
      expect(result.score).toBe(Math.round(100 * SIGNAL_WEIGHTS[name]));
    }
  });

  it("returns an integer score", () => {
    const result = computeHealthScore({ productUsage: 33, engagement: 17, supportBurden: 71 });
    expect(Number.isInteger(result.score)).toBe(true);
  });

  it("lands exactly on 25 → critical", () => {
    const result = computeHealthScore({ ...perfect, productUsage: 0, engagement: 0, supportBurden: 0, paymentTimeliness: 0, relationshipDepth: 100 });
    // relationshipDepth weight is 0.15 → 15; add paymentTimeliness 0.2 * 50 = 10 → 25
    const tuned = computeHealthScore({ relationshipDepth: 100, paymentTimeliness: 50 });
    expect(result.score).toBe(15);
    expect(tuned.score).toBe(25);
    expect(tuned.band).toBe("critical");
  });

  it("lands on 26 → at_risk", () => {
    // 0.3 * 20 = 6, 0.2 * 100 = 20 → 26
    const result = computeHealthScore({ productUsage: 20, paymentTimeliness: 100 });
    expect(result.score).toBe(26);
    expect(result.band).toBe("at_risk");
  });

  it("lands on 50 → at_risk", () => {
    // 0.3 * 100 = 30, 0.2 * 100 = 20 → 50
    const result = computeHealthScore({ productUsage: 100, paymentTimeliness: 100 });
    expect(result.score).toBe(50);
    expect(result.band).toBe("at_risk");
  });

  it("lands on 51 → healthy", () => {
    // 0.3 * 100 = 30, 0.2 * 100 = 20, 0.2 * 5 = 1 → 51
    const result = computeHealthScore({ productUsage: 100, paymentTimeliness: 100, engagement: 5 });
    expect(result.score).toBe(51);
    expect(result.band).toBe("healthy");
  });

  it("lands on 75 → healthy", () => {
    // 0.3*100 + 0.2*100 + 0.2*100 + 0.15*33.333… — use exact weights instead
    const result = computeHealthScore({
      productUsage: 100,
      paymentTimeliness: 100,
      engagement: 100,
      supportBurden: 0,
      relationshipDepth: 0,
    });
    // 30 + 20 + 20 = 70 → healthy
    expect(result.band).toBe("healthy");

    // 70 + 0.15 * 33.34 ≈ 75 exactly at the boundary
    const boundary = computeHealthScore({
      productUsage: 100,
      paymentTimeliness: 100,
      engagement: 100,
      relationshipDepth: 100 / 3,
    });
    expect(boundary.score).toBe(75);
    expect(boundary.band).toBe("healthy");
  });

  it("lands on 76 → thriving", () => {
    // 30 + 20 + 20 + 0.15 * 40 = 76
    const result = computeHealthScore({
      productUsage: 100,
      paymentTimeliness: 100,
      engagement: 100,
      relationshipDepth: 40,
    });
    expect(result.score).toBe(76);
    expect(result.band).toBe("thriving");
  });

  it("clamps a signal above 100 instead of throwing", () => {
    const result = computeHealthScore({ productUsage: 5_000 });
    expect(result.score).toBe(Math.round(100 * SIGNAL_WEIGHTS.productUsage));
    expect(result.contributingFactors.find((f) => f.signal === "productUsage")?.value).toBe(100);
  });

  it("clamps a negative signal to zero instead of throwing", () => {
    const result = computeHealthScore({ productUsage: -500, engagement: -1 });
    expect(result.score).toBe(0);
    expect(result.contributingFactors.every((f) => f.value === 0)).toBe(true);
  });

  it("flags clamped signals in the breakdown", () => {
    const result = computeHealthScore({ productUsage: 150, engagement: 50 });
    expect(result.contributingFactors.find((f) => f.signal === "productUsage")?.clamped).toBe(true);
    expect(result.contributingFactors.find((f) => f.signal === "engagement")?.clamped).toBe(false);
  });

  it("does not flag an absent signal as clamped", () => {
    const result = computeHealthScore({});
    expect(result.contributingFactors.every((f) => f.clamped === false)).toBe(true);
  });

  it("clamps NaN to zero and flags it", () => {
    const result = computeHealthScore({ productUsage: NaN });
    expect(result.score).toBe(0);
    expect(result.contributingFactors.find((f) => f.signal === "productUsage")?.clamped).toBe(true);
  });

  it("clamps Infinity and flags it", () => {
    const result = computeHealthScore({ productUsage: Infinity });
    expect(result.contributingFactors.find((f) => f.signal === "productUsage")?.clamped).toBe(true);
  });

  it("clamps a non-numeric signal without throwing", () => {
    const result = computeHealthScore({ productUsage: "high" } as unknown as HealthSignals);
    expect(result.score).toBe(0);
    expect(result.contributingFactors.find((f) => f.signal === "productUsage")?.clamped).toBe(true);
  });

  it("stays within 0..100 for extreme input", () => {
    const result = computeHealthScore({
      productUsage: 1e12,
      engagement: 1e12,
      supportBurden: 1e12,
      paymentTimeliness: 1e12,
      relationshipDepth: 1e12,
    });
    expect(result.score).toBe(100);
  });

  it("returns one contributing factor per signal", () => {
    expect(computeHealthScore({}).contributingFactors).toHaveLength(HEALTH_SIGNAL_NAMES.length);
  });

  it("sorts contributing factors by contribution descending", () => {
    const result = computeHealthScore({ productUsage: 10, engagement: 100 });
    const contributions = result.contributingFactors.map((f) => f.contribution);
    expect(contributions).toEqual([...contributions].sort((a, b) => b - a));
  });

  it("breaks contribution ties on signal name for a stable top factor", () => {
    const first = computeHealthScore({}).contributingFactors.map((f) => f.signal);
    const second = computeHealthScore({}).contributingFactors.map((f) => f.signal);
    expect(second).toEqual(first);
    expect(first).toEqual([...first].sort());
  });

  it("is deterministic across repeated calls", () => {
    const signals: HealthSignals = { productUsage: 61, engagement: 42, supportBurden: 13 };
    const first = JSON.stringify(computeHealthScore(signals));
    for (let i = 0; i < 10; i += 1) {
      expect(JSON.stringify(computeHealthScore(signals))).toBe(first);
    }
  });
});

// ── GET /v1/recommendations/health/:accountId/breakdown ───────────────────────

describe("GET /v1/recommendations/health/:accountId/breakdown", () => {
  const row = {
    id: "99999999-1111-4000-8000-000000000001",
    accountId: ACCOUNT_ID,
    score: 64,
    factors: { productUsage: 80, engagement: 60, supportBurden: 70, paymentTimeliness: 90, relationshipDepth: 50 },
    computedAt: new Date("2026-02-01T00:00:00.000Z"),
    version: 3,
  };

  it("200 — returns score, band and contributing factors", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(row);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/breakdown`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const data = r.json().data;
    expect(data.accountId).toBe(ACCOUNT_ID);
    // 80*0.3 + 60*0.2 + 70*0.15 + 90*0.2 + 50*0.15 = 72
    expect(data.score).toBe(72);
    expect(data.band).toBe("healthy");
    expect(data.contributingFactors).toHaveLength(5);
    expect(data.storedScore).toBe(64);
    await app.close();
  });

  it("200 — serialises computedAt even when the cache returned an ISO string", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue({ ...row, computedAt: "2026-02-01T00:00:00.000Z" });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/breakdown`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.computedAt).toBe("2026-02-01T00:00:00.000Z");
    await app.close();
  });

  it("200 — ignores legacy RFM factor names", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue({ ...row, factors: { recency: 90, frequency: 80 } });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/breakdown`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.score).toBe(0);
    expect(r.json().data.band).toBe("critical");
    await app.close();
  });

  it("404 — never scored", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/breakdown`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — non-uuid accountId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/health/nope/breakdown",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/breakdown`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/health/${ACCOUNT_ID}/breakdown`,
      headers: strangerAuth(),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/recommendations/health/at-risk ────────────────────────────────────

describe("GET /v1/recommendations/health/at-risk", () => {
  const atRiskRow = {
    id: "99999999-1111-4000-8000-000000000002",
    accountId: ACCOUNT_ID,
    score: 18,
    factors: {},
    computedAt: new Date("2026-02-01T00:00:00.000Z"),
    version: 1,
  };

  it("200 — returns the banded watchlist", async () => {
    H.listAtRiskMock.mockResolvedValue({ rows: [atRiskRow], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/health/at-risk",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data[0].band).toBe("critical");
    expect(r.json().meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    await app.close();
  });

  it("200 — cuts off at the at_risk band ceiling", async () => {
    const app = await buildApp();
    await (await buildApp()).close();
    const app2 = await buildApp();
    const r = await app2.inject({
      method: "GET",
      url: "/v1/recommendations/health/at-risk",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(H.listAtRiskMock).toHaveBeenCalledWith(TENANT, BAND_UPPER_BOUNDS.at_risk, 20);
    await app2.close();
    await app.close();
  });

  it("200 — honours the limit", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/health/at-risk?limit=5",
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(H.listAtRiskMock).toHaveBeenCalledWith(TENANT, BAND_UPPER_BOUNDS.at_risk, 5);
    await app.close();
  });

  it("200 — bands an at_risk score correctly", async () => {
    H.listAtRiskMock.mockResolvedValue({ rows: [{ ...atRiskRow, score: 50 }], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/health/at-risk",
      headers: auth(),
    });
    expect(r.json().data[0].band).toBe("at_risk");
    await app.close();
  });

  it("200 — empty watchlist", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/health/at-risk",
      headers: auth(),
    });
    expect(r.json().data).toEqual([]);
    expect(r.json().meta.total).toBe(0);
    await app.close();
  });

  it("400 — limit above the maximum", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/health/at-risk?limit=500",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — limit below the minimum", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/health/at-risk?limit=0",
      headers: auth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/recommendations/health/at-risk" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/health/at-risk",
      headers: strangerAuth(),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
