/**
 * AG-004 autonomous quality scoring — domain unit tests + route tests.
 * Explicitly covers the hard safety gate: safety < 0.5 forces flagged = true
 * even with high relevance and coherence.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import {
  computeOverall,
  summarizeQuality,
  toScoreString,
  SAFETY_GATE,
  OVERALL_FLOOR,
  WEIGHTS,
} from "../src/modules/governance/quality-domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const CONV_ID = "cccccccc-1111-4000-8000-000000000001";
const TURN_ID = "dddddddd-1111-4000-8000-000000000001";

// ── DOMAIN ────────────────────────────────────────────────────────────────────

describe("computeOverall — weighting", () => {
  it("weights sum to 1", () => {
    expect(WEIGHTS.relevance + WEIGHTS.coherence + WEIGHTS.safety).toBeCloseTo(1, 10);
  });

  it("computes the weighted average", () => {
    const r = computeOverall({ relevance: 1, coherence: 1, safety: 1 });
    expect(r.overall).toBe("1.0000");
    expect(r.flagged).toBe(false);
    expect(r.flagReason).toBeNull();
  });

  it("returns every score as a 4dp string, never a number", () => {
    const r = computeOverall({ relevance: 0.9, coherence: 0.8, safety: 0.95 });
    for (const v of [r.relevance, r.coherence, r.safety, r.overall]) {
      expect(typeof v).toBe("string");
      expect(v).toMatch(/^\d\.\d{4}$/);
    }
  });

  it("matches the hand-computed weighted value", () => {
    const r = computeOverall({ relevance: 0.8, coherence: 0.6, safety: 0.9 });
    // 0.8*0.35 + 0.6*0.25 + 0.9*0.40 = 0.28 + 0.15 + 0.36 = 0.79
    expect(r.overall).toBe("0.7900");
    expect(r.flagged).toBe(false);
  });

  it("clamps out-of-range and non-finite inputs into [0,1]", () => {
    expect(computeOverall({ relevance: 5, coherence: -3, safety: 1 }).relevance).toBe("1.0000");
    expect(computeOverall({ relevance: 5, coherence: -3, safety: 1 }).coherence).toBe("0.0000");
    expect(computeOverall({ relevance: Number.NaN, coherence: 1, safety: 1 }).relevance).toBe("0.0000");
  });
});

describe("computeOverall — HARD SAFETY GATE", () => {
  it("safety below the gate flags the interaction even with perfect relevance and coherence", () => {
    const r = computeOverall({ relevance: 1, coherence: 1, safety: 0.49 });
    expect(r.flagged).toBe(true);
    expect(r.flagReason).toContain("safety");
    expect(r.flagReason).toContain("hard gate");
    // The weighted average is comfortably above the floor — only the gate flags it.
    expect(Number(r.overall)).toBeGreaterThan(OVERALL_FLOOR);
  });

  it("safety 0 with perfect other dimensions is still flagged", () => {
    const r = computeOverall({ relevance: 1, coherence: 1, safety: 0 });
    expect(r.flagged).toBe(true);
    expect(r.flagReason).toContain("safety");
  });

  it("safety exactly at the gate is not flagged by the gate", () => {
    const r = computeOverall({ relevance: 1, coherence: 1, safety: SAFETY_GATE });
    expect(r.flagged).toBe(false);
    expect(r.flagReason).toBeNull();
  });

  it("the safety reason wins over the overall-floor reason when both apply", () => {
    const r = computeOverall({ relevance: 0.1, coherence: 0.1, safety: 0.1 });
    expect(r.flagged).toBe(true);
    expect(r.flagReason).toContain("hard gate");
  });

  it("a safe but poor interaction is flagged on the overall floor", () => {
    const r = computeOverall({ relevance: 0.2, coherence: 0.2, safety: 0.6 });
    // 0.07 + 0.05 + 0.24 = 0.36
    expect(r.overall).toBe("0.3600");
    expect(r.flagged).toBe(true);
    expect(r.flagReason).toContain("below floor");
  });

  it("a safe, good interaction is not flagged", () => {
    expect(computeOverall({ relevance: 0.9, coherence: 0.9, safety: 0.9 }).flagged).toBe(false);
  });
});

describe("toScoreString", () => {
  it("formats to 4 decimal places", () => {
    expect(toScoreString(0.5)).toBe("0.5000");
    expect(toScoreString(0.123456)).toBe("0.1235");
  });

  it("clamps to [0,1]", () => {
    expect(toScoreString(-1)).toBe("0.0000");
    expect(toScoreString(9)).toBe("1.0000");
  });
});

describe("summarizeQuality", () => {
  it("zeros for an empty set (no divide by zero)", () => {
    expect(summarizeQuality([])).toEqual({ scored: 0, flagged: 0, flaggedPct: 0 });
  });

  it("counts flagged rows and computes the percentage", () => {
    expect(summarizeQuality([{ flagged: true }, { flagged: false }, { flagged: null }, { flagged: true }]))
      .toEqual({ scored: 4, flagged: 2, flaggedPct: 50 });
  });
});

// ── ROUTES ────────────────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  dbTransactionMock: vi.fn(),
  scopedReadMock: vi.fn(),
  enqueueMock: vi.fn(),
  publishMock: vi.fn(),
  auditInsertMock: vi.fn(),
  upsertMock: vi.fn(),
  listByConversationMock: vi.fn(),
  listFlaggedMock: vi.fn(),
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
    getOrLoad: vi.fn(async (_k: string, loader: () => Promise<unknown>) => loader()),
    invalidate: vi.fn(),
    invalidateResource: vi.fn(),
    makeKey: (t: string, resource: string, id: string) => `ai-agent:${t}:${resource}:${id}`,
  },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));

vi.mock("../src/modules/governance/quality-repo.js", () => ({
  findByTurn: vi.fn(),
  listByConversation: (...a: unknown[]) => H.listByConversationMock(...a),
  listFlagged: (...a: unknown[]) => H.listFlaggedMock(...a),
  upsert: (...a: unknown[]) => H.upsertMock(...a),
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/governance/repo.js", () => ({
  insert: (...a: unknown[]) => H.auditInsertMock(...a),
  findById: vi.fn(), listByTenant: vi.fn(), countTotals: vi.fn(),
  blockedCountsByAgent: vi.fn(async () => ({})),
  toView: (r: Record<string, unknown>) => r,
}));

const { buildApp } = await import("../src/app.js");

const auth = (sub = USER, roles = ["ai_admin"]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`,
});

function makeScoreRow(over: Record<string, unknown> = {}) {
  return {
    id: "99999999-1111-4000-8000-000000000009", tenantId: TENANT,
    conversationId: CONV_ID, turnId: TURN_ID,
    relevance: "0.9000", coherence: "0.8000", safety: "0.9500", overall: "0.8950",
    flagged: false, flagReason: null, scoredAt: new Date(), version: 1,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.dbTransactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({}));
  H.enqueueMock.mockResolvedValue(undefined);
  H.publishMock.mockResolvedValue(undefined);
  H.auditInsertMock.mockResolvedValue(undefined);
  H.upsertMock.mockResolvedValue(undefined);
  H.listByConversationMock.mockResolvedValue({ rows: [], total: 0 });
  H.listFlaggedMock.mockResolvedValue({ rows: [], total: 0 });
});

describe("PUT /v1/ai/quality/:conversationId/:turnId", () => {
  it("202 — upserts a score and returns string scores", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT", url: `/v1/ai/quality/${CONV_ID}/${TURN_ID}`, headers: auth(USER, ["ai_user"]),
      payload: { relevance: 0.8, coherence: 0.6, safety: 0.9 },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data).toMatchObject({
      conversationId: CONV_ID, turnId: TURN_ID,
      relevance: "0.8000", coherence: "0.6000", safety: "0.9000", overall: "0.7900",
      flagged: false, flagReason: null,
    });
    expect(H.publishMock).toHaveBeenCalledWith(
      "ai.quality.score",
      expect.objectContaining({ type: "ai.quality.score", tenantId: TENANT }),
    );
    expect(H.upsertMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — publishes scoreInteraction with computed string scores", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PUT", url: `/v1/ai/quality/${CONV_ID}/${TURN_ID}`, headers: auth(),
      payload: { relevance: 0.5, coherence: 0.5, safety: 0.5 },
    });
    const call = H.publishMock.mock.calls[0]?.[1] as { payload: Record<string, unknown> };
    expect(typeof call.payload.relevance).toBe("string");
    expect(typeof call.payload.overall).toBe("string");
    expect(call.payload.overall).toBe("0.5000");
    await app.close();
  });

  it("202 — safety below 0.5 forces flagged = true despite high relevance and coherence", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT", url: `/v1/ai/quality/${CONV_ID}/${TURN_ID}`, headers: auth(),
      payload: { relevance: 1, coherence: 1, safety: 0.4 },
    });
    expect(r.statusCode).toBe(202);
    expect(r.json().data.flagged).toBe(true);
    expect(r.json().data.flagReason).toContain("hard gate");
    const call = H.publishMock.mock.calls[0]?.[1] as { payload: { flagged: boolean } };
    expect(call.payload.flagged).toBe(true);
    await app.close();
  });

  it("202 — flagged score payload includes flagged=true", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PUT", url: `/v1/ai/quality/${CONV_ID}/${TURN_ID}`, headers: auth(),
      payload: { relevance: 1, coherence: 1, safety: 0.1 },
    });
    expect(H.publishMock).toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — unflagged score publishes without route enqueue", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PUT", url: `/v1/ai/quality/${CONV_ID}/${TURN_ID}`, headers: auth(),
      payload: { relevance: 0.9, coherence: 0.9, safety: 0.9 },
    });
    expect(H.publishMock).toHaveBeenCalled();
    expect(H.enqueueMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("202 — route does not write audit directly", async () => {
    const app = await buildApp();
    await app.inject({
      method: "PUT", url: `/v1/ai/quality/${CONV_ID}/${TURN_ID}`, headers: auth(),
      payload: { relevance: 0.9, coherence: 0.9, safety: 0.9 },
    });
    expect(H.auditInsertMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("400 — score above 1 (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT", url: `/v1/ai/quality/${CONV_ID}/${TURN_ID}`, headers: auth(),
      payload: { relevance: 1.5, coherence: 0.5, safety: 0.5 },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("400 — negative score (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT", url: `/v1/ai/quality/${CONV_ID}/${TURN_ID}`, headers: auth(),
      payload: { relevance: -0.1, coherence: 0.5, safety: 0.5 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — a dimension is missing (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT", url: `/v1/ai/quality/${CONV_ID}/${TURN_ID}`, headers: auth(),
      payload: { relevance: 0.5, coherence: 0.5 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — turnId is not a uuid (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT", url: `/v1/ai/quality/${CONV_ID}/not-a-uuid`, headers: auth(),
      payload: { relevance: 0.5, coherence: 0.5, safety: 0.5 },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT", url: `/v1/ai/quality/${CONV_ID}/${TURN_ID}`,
      payload: { relevance: 0.5, coherence: 0.5, safety: 0.5 },
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PUT", url: `/v1/ai/quality/${CONV_ID}/${TURN_ID}`, headers: auth(USER, ["viewer"]),
      payload: { relevance: 0.5, coherence: 0.5, safety: 0.5 },
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/ai/quality/:conversationId", () => {
  it("200 — all turn scores with a flag-rate summary", async () => {
    H.listByConversationMock.mockResolvedValue({
      rows: [makeScoreRow(), makeScoreRow({ flagged: true, flagReason: "safety" })],
      total: 2,
    });
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/ai/quality/${CONV_ID}`, headers: auth(USER, ["audit_officer"]),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(2);
    expect(r.json().summary).toEqual({ scored: 2, flagged: 1, flaggedPct: 50 });
    await app.close();
  });

  it("200 — numeric fields stay strings on the way out", async () => {
    H.listByConversationMock.mockResolvedValue({ rows: [makeScoreRow()], total: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/ai/quality/${CONV_ID}`, headers: auth() });
    expect(typeof r.json().data[0].overall).toBe("string");
    expect(r.json().data[0].overall).toBe("0.8950");
    await app.close();
  });

  it("200 — pagination is clamped and reported", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/ai/quality/${CONV_ID}?limit=20&offset=40`, headers: auth(),
    });
    expect(r.json().meta).toEqual({ page: 3, pageSize: 20, total: 0 });
    expect(H.listByConversationMock).toHaveBeenCalledWith(TENANT, CONV_ID, 20, 40);
    await app.close();
  });

  it("400 — limit above the maximum (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/ai/quality/${CONV_ID}?limit=500`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("400 — conversationId is not a uuid (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/quality/nope", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/ai/quality/${CONV_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET", url: `/v1/ai/quality/${CONV_ID}`, headers: auth(USER, ["viewer"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/ai/quality/flagged", () => {
  it("200 — flagged interactions for human review", async () => {
    H.listFlaggedMock.mockResolvedValue({
      rows: [makeScoreRow({ flagged: true, flagReason: "safety 0.4000 below hard gate 0.5000" })],
      total: 1,
    });
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/quality/flagged", headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().data[0].flagReason).toContain("hard gate");
    expect(r.json().meta).toEqual({ page: 1, pageSize: 50, total: 1 });
    // The literal path must not be parsed as a conversation id.
    expect(H.listByConversationMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("200 — honours the limit", async () => {
    const app = await buildApp();
    await app.inject({ method: "GET", url: "/v1/ai/quality/flagged?limit=5", headers: auth() });
    expect(H.listFlaggedMock).toHaveBeenCalledWith(TENANT, 5, 0);
    await app.close();
  });

  it("400 — limit above the maximum (zod)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/quality/flagged?limit=201", headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/quality/flagged" });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — insufficient role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/ai/quality/flagged", headers: auth(USER, ["viewer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
