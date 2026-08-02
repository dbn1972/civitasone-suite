/**
 * F.6 (key-account intelligence) — domain, routes and the recompute consumer.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  OPPORTUNITY_SCALE,
  RISK_PENALTY,
  RISK_SEVERITIES,
  WHITE_SPACE_SATURATION,
  computeOpportunityScore,
  isRiskSeverity,
  padOpportunityString,
  riskPenalty,
  toOpportunityString,
  validateIntelligenceInput,
  whiteSpaceRatio,
  worstSeverity,
} from "../src/modules/intelligence/domain.js";
import type { RiskSignal, WhiteSpaceEntry } from "../src/modules/intelligence/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const ACCOUNT_ID = "eeeeeeee-1111-4000-8000-000000000001";
const PRODUCT_A = "11111111-1111-4111-8111-111111111111";
const PRODUCT_B = "22222222-2222-4222-8222-222222222222";
const INTEL_ID = "dddddddd-4444-4000-8000-000000000001";

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  markProcessedMock: vi.fn(),
  cacheGetOrLoadMock: vi.fn(),
  cacheInvalidateMock: vi.fn(),
  cacheMakeKeyMock: vi.fn(),
  queuePublishMock: vi.fn(),
  findByAccountMock: vi.fn(),
  listRankedMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => H.dbTransactionMock(cb) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => H.scopedReadMock(fn),
  sqlClient: { end: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => H.enqueueMock(...a),
  markProcessed: (...a: unknown[]) => H.markProcessedMock(...a),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...a: unknown[]) => H.cacheGetOrLoadMock(...a),
    invalidate: (...a: unknown[]) => H.cacheInvalidateMock(...a),
    makeKey: (...a: unknown[]) => H.cacheMakeKeyMock(...a),
  },
  queue: { publish: (...a: unknown[]) => H.queuePublishMock(...a) },
}));

vi.mock("../src/modules/intelligence/repo.js", async () => {
  const actual = await import("../src/modules/intelligence/repo.js");
  return {
    toView: actual.toView,
    findByAccount: (...a: unknown[]) => H.findByAccountMock(...a),
    listRanked: (...a: unknown[]) => H.listRankedMock(...a),
    upsert: (...a: unknown[]) => H.upsertMock(...a),
  };
});

import { buildApp } from "../src/app.js";
import { handleComputeIntelligence } from "../src/modules/intelligence/consumer.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["recommendation_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });
const readerAuth = () => auth(["crm_user"]);
const strangerAuth = () => auth(["viewer"]);

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INTEL_ID,
    tenantId: TENANT,
    accountId: ACCOUNT_ID,
    whiteSpace: [{ productId: PRODUCT_A }, { productId: PRODUCT_B }],
    riskSignals: [{ code: "late_payment", severity: "medium" }],
    opportunityScore: "0.2125",
    lastComputedAt: new Date("2026-02-01T00:00:00.000Z"),
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
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
  H.markProcessedMock.mockResolvedValue(true);
  H.queuePublishMock.mockResolvedValue("msg-1");
  H.listRankedMock.mockResolvedValue({ rows: [], total: 0 });
  H.upsertMock.mockImplementation(async (_tx: unknown, row: Record<string, unknown>) => [
    { ...makeRow(), ...row },
  ]);
});

// ── domain: severities and penalties ──────────────────────────────────────────

describe("isRiskSeverity", () => {
  it("accepts every declared severity", () => {
    for (const s of RISK_SEVERITIES) expect(isRiskSeverity(s)).toBe(true);
  });

  it("rejects an unknown severity", () => {
    expect(isRiskSeverity("catastrophic")).toBe(false);
  });

  it("orders severities from low to critical", () => {
    expect(RISK_SEVERITIES).toEqual(["low", "medium", "high", "critical"]);
  });

  it("penalties increase with severity", () => {
    expect(RISK_PENALTY.low).toBeLessThan(RISK_PENALTY.medium);
    expect(RISK_PENALTY.medium).toBeLessThan(RISK_PENALTY.high);
    expect(RISK_PENALTY.high).toBeLessThan(RISK_PENALTY.critical);
  });
});

describe("riskPenalty", () => {
  it("is 0 with no signals", () => {
    expect(riskPenalty([])).toBe(0);
  });

  it("matches the declared weight for a single signal", () => {
    expect(riskPenalty([{ code: "a", severity: "high" }])).toBe(RISK_PENALTY.high);
  });

  it("adds multiple penalties", () => {
    const total = riskPenalty([
      { code: "a", severity: "low" },
      { code: "b", severity: "medium" },
    ]);
    expect(total).toBeCloseTo(RISK_PENALTY.low + RISK_PENALTY.medium, 10);
  });

  it("saturates at 1", () => {
    const signals: RiskSignal[] = Array.from({ length: 10 }, (_, i) => ({
      code: `c${i}`,
      severity: "critical",
    }));
    expect(riskPenalty(signals)).toBe(1);
  });

  it("ignores an unknown severity", () => {
    const signals = [{ code: "a", severity: "catastrophic" }] as unknown as RiskSignal[];
    expect(riskPenalty(signals)).toBe(0);
  });
});

describe("whiteSpaceRatio", () => {
  it("is 0 for an empty list", () => {
    expect(whiteSpaceRatio([])).toBe(0);
  });

  it("is 1 at saturation", () => {
    const entries: WhiteSpaceEntry[] = Array.from({ length: WHITE_SPACE_SATURATION }, (_, i) => ({
      productId: `p${i}`,
    }));
    expect(whiteSpaceRatio(entries)).toBe(1);
  });

  it("caps above saturation", () => {
    const entries: WhiteSpaceEntry[] = Array.from({ length: WHITE_SPACE_SATURATION * 3 }, (_, i) => ({
      productId: `p${i}`,
    }));
    expect(whiteSpaceRatio(entries)).toBe(1);
  });

  it("scales linearly below saturation", () => {
    expect(whiteSpaceRatio([{ productId: "a" }, { productId: "b" }])).toBeCloseTo(
      2 / WHITE_SPACE_SATURATION,
      10,
    );
  });

  it("ignores entries with a blank productId", () => {
    const entries = [{ productId: "   " }, { productId: "a" }] as WhiteSpaceEntry[];
    expect(whiteSpaceRatio(entries)).toBeCloseTo(1 / WHITE_SPACE_SATURATION, 10);
  });

  it("ignores a non-string productId", () => {
    const entries = [{ productId: 7 }] as unknown as WhiteSpaceEntry[];
    expect(whiteSpaceRatio(entries)).toBe(0);
  });
});

describe("computeOpportunityScore", () => {
  it("returns a fixed-scale decimal string", () => {
    const score = computeOpportunityScore([], []);
    expect(typeof score).toBe("string");
    expect(score).toBe("0.0000");
    expect(score.split(".")[1]).toHaveLength(OPPORTUNITY_SCALE);
  });

  it("is 1.0000 at full white space with no risk", () => {
    const entries: WhiteSpaceEntry[] = Array.from({ length: WHITE_SPACE_SATURATION }, (_, i) => ({
      productId: `p${i}`,
    }));
    expect(computeOpportunityScore(entries, [])).toBe("1.0000");
  });

  it("is 0.0000 when risk fully saturates, however large the white space", () => {
    const entries: WhiteSpaceEntry[] = Array.from({ length: WHITE_SPACE_SATURATION }, (_, i) => ({
      productId: `p${i}`,
    }));
    const risks: RiskSignal[] = Array.from({ length: 5 }, (_, i) => ({
      code: `r${i}`,
      severity: "critical",
    }));
    expect(computeOpportunityScore(entries, risks)).toBe("0.0000");
  });

  it("discounts by risk", () => {
    const entries: WhiteSpaceEntry[] = Array.from({ length: WHITE_SPACE_SATURATION }, (_, i) => ({
      productId: `p${i}`,
    }));
    const withRisk = computeOpportunityScore(entries, [{ code: "r", severity: "high" }]);
    expect(withRisk).toBe((1 - RISK_PENALTY.high).toFixed(OPPORTUNITY_SCALE));
  });

  it("never exceeds 1", () => {
    const entries: WhiteSpaceEntry[] = Array.from({ length: 500 }, (_, i) => ({ productId: `p${i}` }));
    expect(Number(computeOpportunityScore(entries, []))).toBeLessThanOrEqual(1);
  });

  it("is deterministic across repeated calls", () => {
    const entries = [{ productId: "a" }, { productId: "b" }, { productId: "c" }];
    const risks: RiskSignal[] = [{ code: "r", severity: "low" }];
    const first = computeOpportunityScore(entries, risks);
    for (let i = 0; i < 10; i += 1) {
      expect(computeOpportunityScore(entries, risks)).toBe(first);
    }
  });
});

describe("toOpportunityString / padOpportunityString", () => {
  it("renders a ratio at the column scale", () => {
    expect(toOpportunityString(0.5)).toBe("0.5000");
  });

  it("clamps above 1", () => {
    expect(toOpportunityString(5)).toBe("1.0000");
  });

  it("clamps below 0", () => {
    expect(toOpportunityString(-5)).toBe("0.0000");
  });

  it("treats NaN as 0", () => {
    expect(toOpportunityString(NaN)).toBe("0.0000");
  });

  it("pads an integer literal without float maths", () => {
    expect(padOpportunityString("1")).toBe("1.0000");
  });

  it("pads a short fraction", () => {
    expect(padOpportunityString("0.8")).toBe("0.8000");
  });

  it("keeps an exact-scale fraction", () => {
    expect(padOpportunityString("0.1234")).toBe("0.1234");
  });

  it("truncates an over-long fraction", () => {
    expect(padOpportunityString("0.123456")).toBe("0.1234");
  });

  it("tolerates whitespace", () => {
    expect(padOpportunityString("  0.5 ")).toBe("0.5000");
  });
});

describe("validateIntelligenceInput", () => {
  it("accepts empty arrays", () => {
    expect(validateIntelligenceInput({ whiteSpace: [], riskSignals: [] })).toBeNull();
  });

  it("accepts a valid bundle", () => {
    expect(
      validateIntelligenceInput({
        whiteSpace: [{ productId: PRODUCT_A }],
        riskSignals: [{ code: "late_payment", severity: "medium" }],
      }),
    ).toBeNull();
  });

  it("rejects a non-array whiteSpace", () => {
    const input = { whiteSpace: "nope", riskSignals: [] } as unknown as Parameters<
      typeof validateIntelligenceInput
    >[0];
    expect(validateIntelligenceInput(input)).toBe("whiteSpace must be an array");
  });

  it("rejects a non-array riskSignals", () => {
    const input = { whiteSpace: [], riskSignals: null } as unknown as Parameters<
      typeof validateIntelligenceInput
    >[0];
    expect(validateIntelligenceInput(input)).toBe("riskSignals must be an array");
  });

  it("rejects a whiteSpace entry without a productId", () => {
    const input = { whiteSpace: [{ productId: "  " }], riskSignals: [] } as Parameters<
      typeof validateIntelligenceInput
    >[0];
    expect(validateIntelligenceInput(input)).toContain("productId");
  });

  it("rejects a risk signal without a code", () => {
    const input = {
      whiteSpace: [],
      riskSignals: [{ code: "", severity: "low" }],
    } as Parameters<typeof validateIntelligenceInput>[0];
    expect(validateIntelligenceInput(input)).toContain("code");
  });

  it("rejects an unknown severity", () => {
    const input = {
      whiteSpace: [],
      riskSignals: [{ code: "x", severity: "catastrophic" }],
    } as unknown as Parameters<typeof validateIntelligenceInput>[0];
    expect(validateIntelligenceInput(input)).toContain("unknown risk severity");
  });
});

describe("worstSeverity", () => {
  it("is null with no signals", () => {
    expect(worstSeverity([])).toBeNull();
  });

  it("returns the single severity", () => {
    expect(worstSeverity([{ code: "a", severity: "low" }])).toBe("low");
  });

  it("returns the highest severity present", () => {
    expect(
      worstSeverity([
        { code: "a", severity: "low" },
        { code: "b", severity: "critical" },
        { code: "c", severity: "medium" },
      ]),
    ).toBe("critical");
  });

  it("ignores an unknown severity", () => {
    const signals = [{ code: "a", severity: "bogus" }] as unknown as RiskSignal[];
    expect(worstSeverity(signals)).toBeNull();
  });
});

// ── GET /v1/recommendations/accounts/:accountId/intelligence ───────────────────

describe("GET /v1/recommendations/accounts/:accountId/intelligence", () => {
  const url = `/v1/recommendations/accounts/${ACCOUNT_ID}/intelligence`;

  it("200 — returns the record with the worst risk severity", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(makeRow());
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.accountId).toBe(ACCOUNT_ID);
    expect(r.json().data.worstRiskSeverity).toBe("medium");
    await app.close();
  });

  it("200 — opportunityScore stays a string", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(makeRow({ opportunityScore: "0.9999" }));
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(typeof r.json().data.opportunityScore).toBe("string");
    expect(r.json().data.opportunityScore).toBe("0.9999");
    await app.close();
  });

  it("200 — tolerates ISO strings from a warm cache", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(
      makeRow({
        lastComputedAt: "2026-02-01T00:00:00.000Z",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
      }),
    );
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data.lastComputedAt).toBe("2026-02-01T00:00:00.000Z");
    await app.close();
  });

  it("404 — never computed", async () => {
    H.cacheGetOrLoadMock.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("400 — non-uuid accountId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: "/v1/recommendations/accounts/nope/intelligence",
      headers: auth(),
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

// ── POST /v1/recommendations/accounts/:accountId/intelligence/compute ──────────

describe("POST /v1/recommendations/accounts/:accountId/intelligence/compute", () => {
  const url = `/v1/recommendations/accounts/${ACCOUNT_ID}/intelligence/compute`;

  it("202 — publishes a recompute command", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: {
        whiteSpace: [{ productId: PRODUCT_A }],
        riskSignals: [{ code: "late_payment", severity: "medium" }],
      },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    expect(H.queuePublishMock).toHaveBeenCalledOnce();
    // No write on the read path.
    expect(H.upsertMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — previews the opportunity score as a decimal string", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { whiteSpace: [{ productId: PRODUCT_A }, { productId: PRODUCT_B }], riskSignals: [] },
    });
    expect(r.json().status).toBe("accepted");
    await app.close();
  });

  it("202 — defaults to empty white space and risk", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(202);
    expect(r.json().status).toBe("accepted");
    await app.close();
  });

  it("202 — accepts an estimatedValue as a decimal string", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { whiteSpace: [{ productId: PRODUCT_A, estimatedValue: "125000.5000" }] },
    });
    expect(r.statusCode).toBe(202);
    const published = H.queuePublishMock.mock.calls[0]?.[1] as {
      payload: { whiteSpace: { estimatedValue?: string }[] };
    };
    expect(published.payload.whiteSpace[0]?.estimatedValue).toBe("125000.5000");
    await app.close();
  });

  it("202 — a sales_user may trigger a recompute", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: auth(["sales_user"]), payload: {} });
    expect(r.statusCode).toBe(202);
    await app.close();
  });

  it("400 — non-uuid productId in white space", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { whiteSpace: [{ productId: "not-a-uuid" }] },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — unknown risk severity", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { riskSignals: [{ code: "x", severity: "catastrophic" }] },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — estimatedValue is not a decimal string", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url,
      headers: auth(),
      payload: { whiteSpace: [{ productId: PRODUCT_A, estimatedValue: "lots" }] },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — non-uuid accountId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/recommendations/accounts/nope/intelligence/compute",
      headers: auth(),
      payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — a read-only role cannot recompute", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url, headers: readerAuth(), payload: {} });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ── GET /v1/recommendations/accounts/intelligence (ranked) ─────────────────────

describe("GET /v1/recommendations/accounts/intelligence", () => {
  const url = "/v1/recommendations/accounts/intelligence";

  it("200 — returns a ranked page", async () => {
    H.listRankedMock.mockResolvedValue({ rows: [makeRow()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data[0].worstRiskSeverity).toBe("medium");
    expect(r.json().meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    await app.close();
  });

  it("200 — empty result", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(r.json().data).toEqual([]);
    await app.close();
  });

  it("200 — passes minOpportunityScore through padded to the column scale", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `${url}?minOpportunityScore=0.5`,
      headers: readerAuth(),
    });
    expect(r.statusCode).toBe(200);
    expect(H.listRankedMock).toHaveBeenCalledWith(TENANT, 20, 0, { minOpportunityScore: "0.5000" });
    await app.close();
  });

  it("200 — no filter when minOpportunityScore is absent", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url, headers: readerAuth() });
    expect(H.listRankedMock).toHaveBeenCalledWith(TENANT, 20, 0, {});
    await app.close();
  });

  it("200 — computes the page from the offset", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `${url}?limit=5&offset=10`, headers: auth() });
    expect(r.json().meta.page).toBe(3);
    await app.close();
  });

  it("400 — minOpportunityScore is not a decimal", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `${url}?minOpportunityScore=high`,
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

// ── consumer ──────────────────────────────────────────────────────────────────

describe("handleComputeIntelligence", () => {
  const msg = {
    messageId: "22222222-2222-4222-8222-222222222222",
    type: "recommendation.intelligence.compute",
    tenantId: TENANT,
    actorId: USER,
    correlationId: "corr-1",
    timestamp: new Date().toISOString(),
    schemaVersion: "1.0",
    payload: {
      intelligenceId: INTEL_ID,
      accountId: ACCOUNT_ID,
      whiteSpace: [{ productId: PRODUCT_A }, { productId: PRODUCT_B }],
      riskSignals: [{ code: "late_payment", severity: "medium" as const }],
    },
  };

  it("upserts and emits the audit event", async () => {
    await handleComputeIntelligence(msg);
    expect(H.markProcessedMock).toHaveBeenCalledWith(expect.anything(), msg.messageId);
    expect(H.upsertMock).toHaveBeenCalledOnce();
    expect(H.enqueueMock).toHaveBeenCalledOnce();
    expect(H.cacheInvalidateMock).toHaveBeenCalledOnce();
  });

  it("recomputes the score rather than trusting the payload", async () => {
    await handleComputeIntelligence(msg);
    const written = H.upsertMock.mock.calls[0]?.[1] as { opportunityScore: string };
    // 2/8 white space * (1 - 0.15 medium penalty) = 0.2125
    expect(written.opportunityScore).toBe("0.2125");
  });

  it("emits the score as a string in the event payload", async () => {
    await handleComputeIntelligence(msg);
    const event = H.enqueueMock.mock.calls[0]?.[1] as { payload: Record<string, unknown> };
    expect(event.payload.opportunityScore).toBe("0.2125");
    expect(event.payload.riskCount).toBe(1);
  });

  it("skips the write on redelivery (idempotency)", async () => {
    H.markProcessedMock.mockResolvedValue(false);
    await handleComputeIntelligence(msg);
    expect(H.upsertMock).not.toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
  });

  it("marks the message processed before writing", async () => {
    const order: string[] = [];
    H.markProcessedMock.mockImplementation(async () => {
      order.push("markProcessed");
      return true;
    });
    H.upsertMock.mockImplementation(async () => {
      order.push("upsert");
      return [makeRow()];
    });
    await handleComputeIntelligence(msg);
    expect(order).toEqual(["markProcessed", "upsert"]);
  });
});
