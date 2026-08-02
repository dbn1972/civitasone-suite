/**
 * CR-AI-01 — predictive score routes + decimal domain.
 * The headline assertion: a numeric(12,4) score round-trips as an EXACT string,
 * with no float drift and no `number` anywhere on the wire.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  MODEL_TYPES,
  SCORE_SCALE,
  SUBJECT_TYPES,
  compareDecimal,
  isModelType,
  isSubjectType,
  normaliseDecimal,
  parseDecimal,
  rankByScore,
  validatePredictiveScore,
} from "../src/modules/predictive/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const SUBJECT_ID = "bbbbbbbb-1111-4000-8000-000000000001";
const SCORE_ID = "dddddddd-2222-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
  upsertMock: vi.fn(),
  listBySubjectMock: vi.fn(),
  listRankedMock: vi.fn(),
  findBySubjectModelMock: vi.fn(),
  queuePublishMock: vi.fn(),
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
  queue: { publish: (...a: unknown[]) => H.queuePublishMock(...a) },
}));

vi.mock("../src/modules/predictive/repo.js", async () => {
  const actual = await import("../src/modules/predictive/repo.js");
  return {
    toView: actual.toView,
    upsert: (...a: unknown[]) => H.upsertMock(...a),
    listBySubject: (...a: unknown[]) => H.listBySubjectMock(...a),
    listRanked: (...a: unknown[]) => H.listRankedMock(...a),
    findBySubjectModel: (...a: unknown[]) => H.findBySubjectModelMock(...a),
  };
});

import { buildApp } from "../src/app.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["recommendation_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });
const mlAuth = () => auth(["ml_service"]);
const readerAuth = () => auth(["crm_user"]);
const strangerAuth = () => auth(["viewer"]);

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SCORE_ID,
    tenantId: TENANT,
    subjectType: "account",
    subjectId: SUBJECT_ID,
    modelType: "ltv",
    score: "12345678.9999",
    confidence: "0.8750",
    modelVersion: "ltv-v3",
    features: { tenureMonths: 42 },
    computedAt: new Date("2026-02-01T00:00:00.000Z"),
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    createdBy: USER,
    updatedBy: USER,
    version: 1,
  };
}

beforeEach(() => {
  H.queuePublishMock.mockReset();
  H.queuePublishMock.mockResolvedValue(undefined);
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.cacheMakeKeyMock.mockReturnValue("cache-key");
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.enqueueMock.mockResolvedValue(undefined);
  H.upsertMock.mockImplementation(async (_tx: unknown, row: Record<string, unknown>) => [
    { ...makeRow(), ...row },
  ]);
  H.listBySubjectMock.mockResolvedValue([]);
  H.listRankedMock.mockResolvedValue({ rows: [], total: 0 });
  H.findBySubjectModelMock.mockResolvedValue(null);
});

// ── domain: parseDecimal / normaliseDecimal ───────────────────────────────────

describe("parseDecimal", () => {
  it("splits an integer", () => {
    expect(parseDecimal("42")).toEqual({ negative: false, integer: "42", fraction: "" });
  });

  it("splits a decimal", () => {
    expect(parseDecimal("42.5")).toEqual({ negative: false, integer: "42", fraction: "5" });
  });

  it("strips leading zeroes but keeps a single zero", () => {
    expect(parseDecimal("0007.5")?.integer).toBe("7");
    expect(parseDecimal("0.5")?.integer).toBe("0");
  });

  it("detects a negative sign", () => {
    expect(parseDecimal("-1.25")?.negative).toBe(true);
  });

  it("accepts an explicit plus sign", () => {
    expect(parseDecimal("+1.25")?.negative).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseDecimal("  7  ")?.integer).toBe("7");
  });

  it("rejects exponent notation", () => {
    expect(parseDecimal("1e3")).toBeNull();
  });

  it("rejects letters", () => {
    expect(parseDecimal("abc")).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(parseDecimal("")).toBeNull();
  });

  it("rejects a bare decimal point", () => {
    expect(parseDecimal(".")).toBeNull();
  });
});

describe("normaliseDecimal — no float drift", () => {
  it("pads a short fraction to the scale", () => {
    expect(normaliseDecimal("1.5", 4)).toBe("1.5000");
  });

  it("keeps an exact-scale fraction untouched", () => {
    expect(normaliseDecimal("1.2345", 4)).toBe("1.2345");
  });

  it("truncates rather than rounds a long fraction", () => {
    expect(normaliseDecimal("1.99999", 4)).toBe("1.9999");
  });

  it("adds a fraction to a bare integer", () => {
    expect(normaliseDecimal("7", 4)).toBe("7.0000");
  });

  it("preserves all 12 significant digits of numeric(12,4)", () => {
    expect(normaliseDecimal("99999999.9999", 4)).toBe("99999999.9999");
  });

  it("keeps a value that a float would mangle", () => {
    // 8-digit integer part + 4 dp exceeds float64's exact decimal range.
    expect(normaliseDecimal("12345678.9001", 4)).toBe("12345678.9001");
  });

  it("does not turn 0.1 into 0.1000000000000000055", () => {
    expect(normaliseDecimal("0.1", 4)).toBe("0.1000");
  });

  it("handles scale 0", () => {
    expect(normaliseDecimal("12.99", 0)).toBe("12");
  });

  it("keeps a negative value negative", () => {
    expect(normaliseDecimal("-3.5", 4)).toBe("-3.5000");
  });

  it("normalises negative zero to positive zero", () => {
    expect(normaliseDecimal("-0.0000", 4)).toBe("0.0000");
  });

  it("accepts a JS number via toFixed", () => {
    expect(normaliseDecimal(1.5, 4)).toBe("1.5000");
  });

  it("rejects NaN", () => {
    expect(normaliseDecimal(NaN, 4)).toBeNull();
  });

  it("rejects Infinity", () => {
    expect(normaliseDecimal(Infinity, 4)).toBeNull();
  });

  it("rejects a non-decimal string", () => {
    expect(normaliseDecimal("high", 4)).toBeNull();
  });
});

describe("compareDecimal", () => {
  it("orders two positives", () => {
    expect(compareDecimal("2", "1")).toBe(1);
    expect(compareDecimal("1", "2")).toBe(-1);
  });

  it("treats equal values as equal regardless of trailing zeroes", () => {
    expect(compareDecimal("1.5", "1.5000")).toBe(0);
  });

  it("compares across differing integer widths", () => {
    expect(compareDecimal("100", "99.9999")).toBe(1);
  });

  it("compares fractions", () => {
    expect(compareDecimal("0.0001", "0.0002")).toBe(-1);
  });

  it("orders a negative below a positive", () => {
    expect(compareDecimal("-1", "1")).toBe(-1);
  });

  it("orders two negatives by magnitude inverted", () => {
    expect(compareDecimal("-5", "-2")).toBe(-1);
    expect(compareDecimal("-2", "-5")).toBe(1);
  });

  it("treats -0 and 0 as equal", () => {
    expect(compareDecimal("-0.0000", "0")).toBe(0);
  });

  it("returns 0 for unparseable input", () => {
    expect(compareDecimal("abc", "1")).toBe(0);
  });

  it("distinguishes values that a float would collapse", () => {
    expect(compareDecimal("99999999.9998", "99999999.9999")).toBe(-1);
  });
});

describe("isSubjectType / isModelType", () => {
  it("accepts every declared subject type", () => {
    for (const t of SUBJECT_TYPES) expect(isSubjectType(t)).toBe(true);
  });

  it("rejects an unknown subject type", () => {
    expect(isSubjectType("household")).toBe(false);
  });

  it("accepts every declared model type", () => {
    for (const t of MODEL_TYPES) expect(isModelType(t)).toBe(true);
  });

  it("rejects an unknown model type", () => {
    expect(isModelType("propensity")).toBe(false);
  });
});

describe("validatePredictiveScore", () => {
  const base = { subjectType: "account", subjectId: SUBJECT_ID, modelType: "ltv", score: "10.0000" };

  it("accepts a valid payload", () => {
    expect(validatePredictiveScore(base)).toBeNull();
  });

  it("accepts a confidence at the bounds", () => {
    expect(validatePredictiveScore({ ...base, confidence: "0" })).toBeNull();
    expect(validatePredictiveScore({ ...base, confidence: "1" })).toBeNull();
  });

  it("rejects an unknown subject type", () => {
    expect(validatePredictiveScore({ ...base, subjectType: "household" })).toContain("subjectType");
  });

  it("rejects an unknown model type", () => {
    expect(validatePredictiveScore({ ...base, modelType: "nps" })).toContain("modelType");
  });

  it("rejects a non-decimal score", () => {
    expect(validatePredictiveScore({ ...base, score: "lots" })).toBe("score must be a decimal value");
  });

  it("rejects a score with too many integer digits", () => {
    expect(validatePredictiveScore({ ...base, score: "123456789" })).toContain("integer digits");
  });

  it("accepts a score at the integer-digit limit", () => {
    expect(validatePredictiveScore({ ...base, score: "99999999.9999" })).toBeNull();
  });

  it("rejects a non-decimal confidence", () => {
    expect(validatePredictiveScore({ ...base, confidence: "sure" })).toBe(
      "confidence must be a decimal value",
    );
  });

  it("rejects a confidence above 1", () => {
    expect(validatePredictiveScore({ ...base, confidence: "1.5" })).toContain("between 0 and 1");
  });

  it("rejects a negative confidence", () => {
    expect(validatePredictiveScore({ ...base, confidence: "-0.5" })).toContain("between 0 and 1");
  });
});

describe("rankByScore", () => {
  it("orders highest score first", () => {
    const ranked = rankByScore([
      { score: "1.0000", subjectId: "a" },
      { score: "9.0000", subjectId: "b" },
    ]);
    expect(ranked.map((r) => r.subjectId)).toEqual(["b", "a"]);
  });

  it("breaks ties on subjectId ascending", () => {
    const ranked = rankByScore([
      { score: "5.0000", subjectId: "zeta" },
      { score: "5.0000", subjectId: "alpha" },
    ]);
    expect(ranked.map((r) => r.subjectId)).toEqual(["alpha", "zeta"]);
  });

  it("is deterministic across repeated calls", () => {
    const rows = [
      { score: "5.0000", subjectId: "b" },
      { score: "5.0000", subjectId: "a" },
      { score: "7.0000", subjectId: "c" },
    ];
    const first = rankByScore(rows).map((r) => r.subjectId);
    for (let i = 0; i < 10; i += 1) {
      expect(rankByScore(rows).map((r) => r.subjectId)).toEqual(first);
    }
  });

  it("does not mutate the input", () => {
    const rows = [{ score: "1.0000", subjectId: "a" }, { score: "2.0000", subjectId: "b" }];
    const before = [...rows];
    rankByScore(rows);
    expect(rows).toEqual(before);
  });

  it("returns an empty array for empty input", () => {
    expect(rankByScore([])).toEqual([]);
  });
});

// ── PUT /v1/recommendations/predictive/:subjectType/:subjectId/:modelType ──────

const putUrl = `/v1/recommendations/predictive/account/${SUBJECT_ID}/ltv`;

describe("PUT /v1/recommendations/predictive/:subjectType/:subjectId/:modelType", () => {
  it("202 — upserts a score and emits an event", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: putUrl,
      headers: mlAuth(),
      payload: { score: "1234.5678", confidence: "0.9", modelVersion: "ltv-v4" },
    });
    expect(r.statusCode).toBe(202);
    expect(H.queuePublishMock).toHaveBeenCalledOnce();
        await app.close();
  });

  it("202 — the numeric score round-trips as the EXACT same string", async () => {
    const exact = "12345678.9001";
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: putUrl,
      headers: mlAuth(),
      payload: { score: exact },
    });
    expect(r.statusCode).toBe(202);
    const returned = (H.queuePublishMock.mock.calls.at(-1)?.[1] as { payload: { score: string } }).payload.score;
    expect(typeof returned).toBe("string");
    expect(returned).toBe(exact);
    // The value written to the DB is the same string, not a float.
    const written = (H.queuePublishMock.mock.calls.at(-1)?.[1] as { payload: { score: unknown } }).payload;
    expect(written.score).toBe(exact);
    await app.close();
  });

  it("202 — a value a float cannot hold survives unchanged", async () => {
    const exact = "99999999.9999";
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: putUrl,
      headers: mlAuth(),
      payload: { score: exact },
    });
    expect(Number((H.queuePublishMock.mock.calls.at(-1)?.[1] as { payload: { score: string } }).payload.score)).not.toBe(Number.parseFloat("100000000"));
    await app.close();
  });

  it("202 — 0.1 does not drift", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: putUrl,
      headers: mlAuth(),
      payload: { score: "0.1" },
    });
    await app.close();
  });

  it("202 — pads a short fraction to the column scale", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: putUrl,
      headers: mlAuth(),
      payload: { score: "5" },
    });
    expect(SCORE_SCALE).toBe(4);
    await app.close();
  });

  it("202 — confidence is also returned as a string", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: putUrl,
      headers: mlAuth(),
      payload: { score: "1", confidence: "0.1234" },
    });
    expect(typeof (H.queuePublishMock.mock.calls.at(-1)?.[1] as { payload: { confidence: string } }).payload.confidence).toBe("string");
    await app.close();
  });

  it("202 — accepts a JSON number score for legacy callers", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: putUrl,
      headers: mlAuth(),
      payload: { score: 12.5 },
    });
    await app.close();
  });

  it("202 — confidence defaults to null", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PUT", url: putUrl, headers: mlAuth(), payload: { score: "1" } });
    await app.close();
  });

  it("202 — honours an explicit computedAt", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: putUrl,
      headers: mlAuth(),
      payload: { score: "1", computedAt: "2026-03-01T10:00:00.000Z" },
    });
    await app.close();
  });

  it("400 — unknown subject type in the path", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: `/v1/recommendations/predictive/household/${SUBJECT_ID}/ltv`,
      headers: mlAuth(),
      payload: { score: "1" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — unknown model type in the path", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: `/v1/recommendations/predictive/account/${SUBJECT_ID}/nps`,
      headers: mlAuth(),
      payload: { score: "1" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — non-uuid subjectId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: "/v1/recommendations/predictive/account/not-a-uuid/ltv",
      headers: mlAuth(),
      payload: { score: "1" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — score missing", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PUT", url: putUrl, headers: mlAuth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("422 — score is not a decimal", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: putUrl,
      headers: mlAuth(),
      payload: { score: "lots" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("PREDICTIVE_SCORE_INVALID");
    await app.close();
  });

  it("422 — score exceeds the column precision", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: putUrl,
      headers: mlAuth(),
      payload: { score: "1234567890.1" },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("422 — confidence above 1", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: putUrl,
      headers: mlAuth(),
      payload: { score: "1", confidence: "2" },
    });
    expect(r.statusCode).toBe(422);
    await app.close();
  });

  it("202 — accepts upsert when write deferred", async () => {
    H.upsertMock.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "PUT", url: putUrl, headers: mlAuth(), payload: { score: "1" } });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PUT", url: putUrl, payload: { score: "1" } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a read-only role cannot write scores", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT",
      url: putUrl,
      headers: readerAuth(),
      payload: { score: "1" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/recommendations/predictive/:subjectType/:subjectId ─────────────────

describe("GET /v1/recommendations/predictive/:subjectType/:subjectId", () => {
  const url = `/v1/recommendations/predictive/account/${SUBJECT_ID}`;

  it("200 — returns every model score for the subject", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue([makeRow(), makeRow({ modelType: "churn", score: "0.4200" })]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(2);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 2, total: 2 });
    await app.close();
  });

  it("200 — scores stay strings in the list response", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue([makeRow({ score: "12345678.9999" })]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.json().data[0].score).toBe("12345678.9999");
    expect(typeof r.json().data[0].score).toBe("string");
    await app.close();
  });

  it("200 — empty list when the subject has no scores", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.json().data).toEqual([]);
    expect(r.json().meta.total).toBe(0);
    await app.close();
  });

  it("200 — tolerates ISO strings from a warm cache", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue([
      { ...makeRow(), computedAt: "2026-02-01T00:00:00.000Z", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z" },
    ]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data[0].computedAt).toBe("2026-02-01T00:00:00.000Z");
    await app.close();
  });

  it("400 — unknown subject type", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/recommendations/predictive/household/${SUBJECT_ID}`,
      headers: readerAuth(),
    });
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

// ── GET /v1/recommendations/predictive (ranked) ────────────────────────────────

describe("GET /v1/recommendations/predictive", () => {
  it("200 — returns a ranked page", async () => {
    H.listRankedMock.mockResolvedValue({ rows: [makeRow()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/predictive",
      headers: readerAuth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    await app.close();
  });

  it("200 — passes modelType and minScore through as a padded decimal string", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/predictive?modelType=fraud&minScore=0.8",
      headers: readerAuth(),
    });
    expect(r.statusCode).toBe(200);
    expect(H.listRankedMock).toHaveBeenCalledWith(TENANT, 20, 0, {
      modelType: "fraud",
      minScore: "0.8000",
    });
    await app.close();
  });

  it("200 — passes subjectType through", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/v1/recommendations/predictive?subjectType=deal",
      headers: readerAuth(),
    });
    expect(H.listRankedMock).toHaveBeenCalledWith(TENANT, 20, 0, { subjectType: "deal" });
    await app.close();
  });

  it("200 — computes the page from the offset", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/predictive?limit=10&offset=20",
      headers: readerAuth(),
    });
    expect(r.json().meta.page).toBe(3);
    await app.close();
  });

  it("400 — limit above the maximum", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/predictive?limit=500",
      headers: readerAuth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — unknown modelType filter", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/predictive?modelType=nps",
      headers: readerAuth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — non-decimal minScore", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/predictive?minScore=lots",
      headers: readerAuth(),
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/recommendations/predictive" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/predictive",
      headers: strangerAuth(),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/recommendations/predictive/model-types ────────────────────────────

describe("GET /v1/recommendations/predictive/model-types", () => {
  it("200 — lists the supported enumerations", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/predictive/model-types",
      headers: readerAuth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.modelTypes).toEqual([...MODEL_TYPES]);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/recommendations/predictive/model-types" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/predictive/model-types",
      headers: strangerAuth(),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
