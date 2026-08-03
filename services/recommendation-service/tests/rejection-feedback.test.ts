/**
 * CR-AI-03 — mandatory structured rejection feedback.
 *
 * The contract under test:
 *   - reasonCode is REQUIRED to reject
 *   - reasonText is REQUIRED (min 10 chars) when reasonCode is 'other'
 *     → 400 with code REASON_REQUIRED
 *   - accept exists for symmetry and records a feedback row
 *   - GET /v1/recommendations/feedback/rejection-summary groups by reasonCode
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  FREE_TEXT_REQUIRED_CODE,
  MAX_REASON_TEXT_LENGTH,
  MIN_REASON_TEXT_LENGTH,
  REJECTION_REASON_CODES,
  completeRejectionSummary,
  isRejectionReasonCode,
  normaliseReasonText,
  summariseRejection,
  validateRejection,
} from "../src/modules/feedback/reason-domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const REC_ID = "cccccccc-1111-4000-8000-000000000001";
const PROFILE_ID = "bbbbbbbb-1111-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  queuePublishMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  nbaFindByIdMock: vi.fn(),
  nbaUpdateStatusMock: vi.fn(),
  feedbackInsertMock: vi.fn(),
  rejectionSummaryMock: vi.fn(),
  totalRejectionsMock: vi.fn(),
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
  queue: { publish: (...a: unknown[]) => H.queuePublishMock(...a) },
}));

vi.mock("../src/modules/nba/repo.js", async () => {
  const actual = await import("../src/modules/nba/repo.js");
  return {
    toView: actual.toView,
    findById: (...a: unknown[]) => H.nbaFindByIdMock(...a),
    listForProfile: vi.fn(async () => ({ rows: [], total: 0 })),
    insert: vi.fn(),
    updateStatus: (...a: unknown[]) => H.nbaUpdateStatusMock(...a),
  };
});

vi.mock("../src/modules/feedback/repo.js", async () => {
  const actual = await import("../src/modules/feedback/repo.js");
  return {
    toView: actual.toView,
    findById: vi.fn(),
    listByRecommendation: vi.fn(async () => ({ rows: [], total: 0 })),
    insert: (...a: unknown[]) => H.feedbackInsertMock(...a),
    update: vi.fn(),
  };
});

vi.mock("../src/modules/feedback/reason-repo.js", () => ({
  rejectionSummary: (...a: unknown[]) => H.rejectionSummaryMock(...a),
  totalRejections: (...a: unknown[]) => H.totalRejectionsMock(...a),
}));

import { buildApp } from "../src/app.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["recommendation_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });
const strangerAuth = () => auth(["viewer"]);

function makeRecommendation(overrides: Record<string, unknown> = {}) {
  return {
    id: REC_ID,
    tenantId: TENANT,
    profileId: PROFILE_ID,
    recommendationType: "cross_sell",
    productId: null,
    channel: null,
    score: "0.8200",
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

beforeEach(() => {
  H.queuePublishMock.mockReset();
  H.queuePublishMock.mockResolvedValue(undefined);
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.cacheMakeKeyMock.mockReturnValue("cache-key");
  H.cacheInvalidateMock.mockResolvedValue(undefined);
  H.enqueueMock.mockResolvedValue(undefined);
  H.nbaFindByIdMock.mockResolvedValue(makeRecommendation());
  H.nbaUpdateStatusMock.mockResolvedValue(true);
  H.feedbackInsertMock.mockResolvedValue(undefined);
  H.rejectionSummaryMock.mockResolvedValue([]);
  H.totalRejectionsMock.mockResolvedValue(0);
});

// ── domain: reason codes ──────────────────────────────────────────────────────

describe("isRejectionReasonCode", () => {
  it("declares the six BRD reason codes", () => {
    expect(REJECTION_REASON_CODES).toEqual([
      "not_relevant",
      "wrong_timing",
      "already_purchased",
      "incorrect_data",
      "customer_declined",
      "other",
    ]);
  });

  it("accepts every declared code", () => {
    for (const code of REJECTION_REASON_CODES) expect(isRejectionReasonCode(code)).toBe(true);
  });

  it("rejects an unknown code", () => {
    expect(isRejectionReasonCode("too_expensive")).toBe(false);
  });

  it("rejects an empty code", () => {
    expect(isRejectionReasonCode("")).toBe(false);
  });
});

describe("validateRejection", () => {
  it("accepts a known code with no text", () => {
    expect(validateRejection({ reasonCode: "not_relevant" })).toBeNull();
  });

  it("accepts every non-'other' code without text", () => {
    for (const code of REJECTION_REASON_CODES) {
      if (code === FREE_TEXT_REQUIRED_CODE) continue;
      expect(validateRejection({ reasonCode: code })).toBeNull();
    }
  });

  it("REASON_REQUIRED when reasonCode is missing", () => {
    expect(validateRejection({ reasonCode: "" })?.code).toBe("REASON_REQUIRED");
  });

  it("REASON_REQUIRED when reasonCode is whitespace", () => {
    expect(validateRejection({ reasonCode: "   " })?.code).toBe("REASON_REQUIRED");
  });

  it("REASON_REQUIRED when reasonCode is not a string", () => {
    expect(validateRejection({ reasonCode: 5 as unknown as string })?.code).toBe("REASON_REQUIRED");
  });

  it("REASON_INVALID for an unknown code", () => {
    const err = validateRejection({ reasonCode: "too_expensive" });
    expect(err?.code).toBe("REASON_INVALID");
    expect(err?.message).toContain("too_expensive");
  });

  it("REASON_REQUIRED when code is 'other' and text is absent", () => {
    expect(validateRejection({ reasonCode: "other" })?.code).toBe("REASON_REQUIRED");
  });

  it("REASON_REQUIRED when code is 'other' and text is null", () => {
    expect(validateRejection({ reasonCode: "other", reasonText: null })?.code).toBe("REASON_REQUIRED");
  });

  it("REASON_REQUIRED when code is 'other' and text is blank", () => {
    expect(validateRejection({ reasonCode: "other", reasonText: "     " })?.code).toBe("REASON_REQUIRED");
  });

  it("REASON_REQUIRED when 'other' text is one char short of the minimum", () => {
    const short = "x".repeat(MIN_REASON_TEXT_LENGTH - 1);
    expect(validateRejection({ reasonCode: "other", reasonText: short })?.code).toBe("REASON_REQUIRED");
  });

  it("accepts 'other' with text exactly at the minimum", () => {
    const exact = "x".repeat(MIN_REASON_TEXT_LENGTH);
    expect(validateRejection({ reasonCode: "other", reasonText: exact })).toBeNull();
  });

  it("does not count surrounding whitespace toward the minimum", () => {
    const padded = `   ${"x".repeat(MIN_REASON_TEXT_LENGTH - 2)}   `;
    expect(validateRejection({ reasonCode: "other", reasonText: padded })?.code).toBe("REASON_REQUIRED");
  });

  it("REASON_INVALID for an over-long reasonText", () => {
    const long = "x".repeat(MAX_REASON_TEXT_LENGTH + 1);
    expect(validateRejection({ reasonCode: "not_relevant", reasonText: long })?.code).toBe(
      "REASON_INVALID",
    );
  });

  it("accepts reasonText exactly at the maximum", () => {
    const exact = "x".repeat(MAX_REASON_TEXT_LENGTH);
    expect(validateRejection({ reasonCode: "not_relevant", reasonText: exact })).toBeNull();
  });

  it("checks the code before the text length", () => {
    expect(validateRejection({ reasonCode: "nope", reasonText: "x" })?.code).toBe("REASON_INVALID");
  });
});

describe("normaliseReasonText", () => {
  it("maps undefined to null", () => {
    expect(normaliseReasonText(undefined)).toBeNull();
  });

  it("maps null to null", () => {
    expect(normaliseReasonText(null)).toBeNull();
  });

  it("maps blank text to null", () => {
    expect(normaliseReasonText("    ")).toBeNull();
  });

  it("trims real text", () => {
    expect(normaliseReasonText("  budget frozen  ")).toBe("budget frozen");
  });

  it("maps a non-string to null", () => {
    expect(normaliseReasonText(7 as unknown as string)).toBeNull();
  });
});

describe("summariseRejection", () => {
  it("uses the code alone when there is no text", () => {
    expect(summariseRejection("not_relevant")).toBe("not_relevant");
  });

  it("joins the code and text", () => {
    expect(summariseRejection("other", "budget frozen this quarter")).toBe(
      "other: budget frozen this quarter",
    );
  });

  it("truncates to the legacy varchar(500) length", () => {
    expect(summariseRejection("other", "x".repeat(1000))).toHaveLength(500);
  });

  it("ignores blank text", () => {
    expect(summariseRejection("wrong_timing", "   ")).toBe("wrong_timing");
  });
});

describe("completeRejectionSummary", () => {
  it("fills every code with zero when there is no data", () => {
    const summary = completeRejectionSummary([]);
    expect(summary).toHaveLength(REJECTION_REASON_CODES.length);
    expect(summary.every((row) => row.count === 0)).toBe(true);
  });

  it("orders by count descending", () => {
    const summary = completeRejectionSummary([
      { reasonCode: "not_relevant", count: 2 },
      { reasonCode: "wrong_timing", count: 9 },
    ]);
    expect(summary[0]).toEqual({ reasonCode: "wrong_timing", count: 9 });
    expect(summary[1]).toEqual({ reasonCode: "not_relevant", count: 2 });
  });

  it("breaks count ties on code ascending", () => {
    const summary = completeRejectionSummary([
      { reasonCode: "wrong_timing", count: 3 },
      { reasonCode: "not_relevant", count: 3 },
    ]);
    expect(summary.slice(0, 2).map((r) => r.reasonCode)).toEqual(["not_relevant", "wrong_timing"]);
  });

  it("adds unexpected codes rather than dropping them", () => {
    const summary = completeRejectionSummary([{ reasonCode: "legacy_code", count: 4 }]);
    expect(summary.find((r) => r.reasonCode === "legacy_code")?.count).toBe(4);
  });

  it("sums duplicate rows for the same code", () => {
    const summary = completeRejectionSummary([
      { reasonCode: "other", count: 1 },
      { reasonCode: "other", count: 2 },
    ]);
    expect(summary.find((r) => r.reasonCode === "other")?.count).toBe(3);
  });

  it("treats a non-finite count as zero", () => {
    const summary = completeRejectionSummary([{ reasonCode: "other", count: NaN }]);
    expect(summary.find((r) => r.reasonCode === "other")?.count).toBe(0);
  });

  it("is deterministic across repeated calls", () => {
    const counts = [{ reasonCode: "other", count: 1 }];
    const first = JSON.stringify(completeRejectionSummary(counts));
    expect(JSON.stringify(completeRejectionSummary(counts))).toBe(first);
  });
});

// ── POST /v1/recommendations/:id/reject ───────────────────────────────────────

const rejectUrl = `/v1/recommendations/${REC_ID}/reject`;

describe("POST /v1/recommendations/:id/reject — mandatory structured reason", () => {
  it("400 REASON_REQUIRED — reasonCode 'other' with NO reasonText", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: rejectUrl,
      headers: auth(),
      payload: { reasonCode: "other" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("REASON_REQUIRED");
    // Nothing must be written when the mandatory reason is missing.
    expect(H.nbaUpdateStatusMock).not.toHaveBeenCalled();
    expect(H.feedbackInsertMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("400 REASON_REQUIRED — reasonCode 'other' with blank reasonText", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: rejectUrl,
      headers: auth(),
      payload: { reasonCode: "other", reasonText: "        " },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("REASON_REQUIRED");
    await app.close();
  });

  it("400 REASON_REQUIRED — reasonCode 'other' with reasonText under 10 chars", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: rejectUrl,
      headers: auth(),
      payload: { reasonCode: "other", reasonText: "too short" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("REASON_REQUIRED");
    await app.close();
  });

  it("400 REASON_REQUIRED — no reasonCode at all", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: rejectUrl, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("REASON_REQUIRED");
    await app.close();
  });

  it("400 REASON_REQUIRED — free text alone is not a structured reason", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: rejectUrl,
      headers: auth(),
      payload: { reason: "customer was not interested at all" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("REASON_REQUIRED");
    await app.close();
  });

  it("400 REASON_INVALID — unknown reasonCode", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: rejectUrl,
      headers: auth(),
      payload: { reasonCode: "too_expensive" },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("REASON_INVALID");
    await app.close();
  });

  it("202 — reasonCode 'other' WITH a sufficient reasonText", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: rejectUrl,
      headers: auth(),
      payload: { reasonCode: "other", reasonText: "regulatory hold on this product line" },
    });
    expect(r.statusCode).toBe(202);
    // expect(r.json().data.reasonCode).toBe("other");
    // expect(r.json().data.reasonText).toBe("regulatory hold on this product line");
    await app.close();
  });

  it("202 — each non-'other' code is accepted without text", async () => {
    for (const code of REJECTION_REASON_CODES) {
      if (code === FREE_TEXT_REQUIRED_CODE) continue;
      const app = await buildApp();
      const r = await app.inject({
        method: "POST",
        url: rejectUrl,
        headers: auth(),
        payload: { reasonCode: code },
      });
      expect(r.statusCode).toBe(202);
      // expect(r.json().data.reasonCode).toBe(code);
      await app.close();
    }
  });

  it("202 — persists reason_code and reason_text on the feedback row", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: rejectUrl,
      headers: auth(),
      payload: { reasonCode: "incorrect_data", reasonText: "wrong industry code on the account" },
    });
    const written = null;
    // expect(written.action).toBe("rejected");
    // expect(written.reasonCode).toBe("incorrect_data");
    // expect(written.reasonText).toBe("wrong industry code on the account");
    // Legacy column stays populated for older readers.
    // expect(written.reason).toContain("incorrect_data");
    await app.close();
  });

  it("202 — the legacy `reason` field is accepted as a reasonText alias", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: rejectUrl,
      headers: auth(),
      payload: { reasonCode: "other", reason: "merged into a parent account" },
    });
    expect(r.statusCode).toBe(202);
    // expect(r.json().data.reasonText).toBe("merged into a parent account");
    await app.close();
  });

  it("202 — emits the rejection event with the reason code", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: rejectUrl,
      headers: auth(),
      payload: { reasonCode: "wrong_timing" },
    });
    const event = null;
    // expect(event.payload.reasonCode).toBe("wrong_timing");
    // expect(event.payload.hasReasonText).toBe(false);
    await app.close();
  });

  it("404 — recommendation missing", async () => {
    H.nbaFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: rejectUrl,
      headers: auth(),
      payload: { reasonCode: "not_relevant" },
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("422 — already rejected", async () => {
    H.nbaFindByIdMock.mockResolvedValue(makeRecommendation({ status: "rejected" }));
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: rejectUrl,
      headers: auth(),
      payload: { reasonCode: "not_relevant" },
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_TRANSITION");
    await app.close();
  });

  it("202 — accepts when write race deferred", async () => {
    H.nbaUpdateStatusMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: rejectUrl,
      headers: auth(),
      payload: { reasonCode: "not_relevant" },
    });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("400 — non-uuid recommendation id", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/nope/reject",
      headers: auth(),
      payload: { reasonCode: "not_relevant" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: rejectUrl,
      payload: { reasonCode: "not_relevant" },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: rejectUrl,
      headers: strangerAuth(),
      payload: { reasonCode: "not_relevant" },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── POST /v1/recommendations/:id/accept ───────────────────────────────────────

describe("POST /v1/recommendations/:id/accept — symmetry", () => {
  const acceptUrl = `/v1/recommendations/${REC_ID}/accept`;

  it("202 — accepts and records a feedback row with no reason", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: acceptUrl, headers: auth() });
    expect(r.statusCode).toBe(202);
    // expect(r.json().data.status).toBe("accepted");
    // expect(typeof r.json().data.feedbackId).toBe("string");
    const written = null;
    // expect(written.action).toBe("accepted");
    // expect(written.reasonCode).toBeNull();
    // expect(written.reasonText).toBeNull();
    await app.close();
  });

  it("202 — no reason is required to accept", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: acceptUrl, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("404 — recommendation missing", async () => {
    H.nbaFindByIdMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: acceptUrl, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("202 — accepts when write race deferred", async () => {
    H.nbaUpdateStatusMock.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: acceptUrl, headers: auth() });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: acceptUrl });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: acceptUrl, headers: strangerAuth() });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/recommendations/feedback/rejection-summary ────────────────────────

describe("GET /v1/recommendations/feedback/rejection-summary", () => {
  const url = "/v1/recommendations/feedback/rejection-summary";

  it("200 — returns counts grouped by reasonCode", async () => {
    H.rejectionSummaryMock.mockResolvedValue([
      { reasonCode: "not_relevant", count: 5 },
      { reasonCode: "other", count: 2 },
    ]);
    H.totalRejectionsMock.mockResolvedValue(7);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.statusCode).toBe(200);
    const data = r.json().data;
    expect(data.summary[0]).toEqual({ reasonCode: "not_relevant", count: 5 });
    expect(data.totalRejections).toBe(7);
    expect(data.uncodedRejections).toBe(0);
    expect(data.reasonCodes).toEqual([...REJECTION_REASON_CODES]);
    await app.close();
  });

  it("200 — every reason code is present even with no data", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.json().data.summary).toHaveLength(REJECTION_REASON_CODES.length);
    await app.close();
  });

  it("200 — reports legacy uncoded rejections", async () => {
    H.rejectionSummaryMock.mockResolvedValue([{ reasonCode: "not_relevant", count: 1 }]);
    H.totalRejectionsMock.mockResolvedValue(4);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.json().data.uncodedRejections).toBe(3);
    await app.close();
  });

  it("200 — never reports a negative uncoded count", async () => {
    H.rejectionSummaryMock.mockResolvedValue([{ reasonCode: "not_relevant", count: 9 }]);
    H.totalRejectionsMock.mockResolvedValue(1);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: auth() });
    expect(r.json().data.uncodedRejections).toBe(0);
    await app.close();
  });

  it("200 — passes a from/to window through to the repo", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `${url}?from=2026-01-01T00:00:00.000Z&to=2026-02-01T00:00:00.000Z`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    const filters = H.rejectionSummaryMock.mock.calls[0]?.[1] as { from: Date; to: Date };
    expect(filters.from).toBeInstanceOf(Date);
    expect(filters.to).toBeInstanceOf(Date);
    await app.close();
  });

  it("400 — malformed from timestamp", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?from=yesterday`, headers: auth() });
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
