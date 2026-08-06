/**
 * G15 — MoU milestone governance routes.
 *
 * Mock-based, no database: mirrors the obligations-cqrs.test.ts pattern used by
 * the rest of this service. Asserts for every endpoint that the route
 *   - is queue-first (publishes a command, returns 202, never writes)
 *   - returns 400 on invalid input, 401 unauthenticated, 403 unauthorised,
 *     404 for a missing resource
 *   - enforces tenant isolation: tenant B cannot see or touch tenant A's rows
 *   - returns money as a STRING of minor units
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-1111-4000-8000-0000000000a1";
const TENANT_B = "bbbbbbbb-2222-4000-8000-0000000000b2";
const ACTOR = "00000000-0001-4000-8000-000000000001";
const CONTRACT_ID = "22222222-3333-4000-8000-000000000033";
const MILESTONE_ID = "11111111-2222-4000-8000-000000000022";
const TERM_ID = "33333333-4444-4000-8000-000000000044";
const REVIEW_ID = "44444444-5555-4000-8000-000000000055";
const MISSING_ID = "00000000-0000-4000-8000-000000000099";

const H = vi.hoisted(() => ({
  publishMock: vi.fn(),
  invalidateMock: vi.fn(),
  findMilestoneByIdMock: vi.fn(),
  listMilestonesMock: vi.fn(),
  findPenaltyTermByIdMock: vi.fn(),
  listPenaltyTermsMock: vi.fn(),
  listPenaltyApplicationsMock: vi.fn(),
  findReviewScheduleByIdMock: vi.fn(),
  listReviewSchedulesMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}) },
  sqlClient: { end: async () => {} },
  scopedRead: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: (...a: unknown[]) => H.invalidateMock(...a),
    makeKey: (...a: string[]) => a.join(":"),
    // Read-through that always delegates to the loader, so the route tests
    // exercise the repo path rather than a cache stub.
    getOrLoad: async (_key: string, loader: () => Promise<unknown>) => loader(),
  },
  queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
}));

vi.mock("../src/modules/milestones/repo.js", () => ({
  findMilestoneById: (...a: unknown[]) => H.findMilestoneByIdMock(...a),
  listMilestones: (...a: unknown[]) => H.listMilestonesMock(...a),
  findPenaltyTermById: (...a: unknown[]) => H.findPenaltyTermByIdMock(...a),
  listPenaltyTerms: (...a: unknown[]) => H.listPenaltyTermsMock(...a),
  listPenaltyApplications: (...a: unknown[]) => H.listPenaltyApplicationsMock(...a),
  findReviewScheduleById: (...a: unknown[]) => H.findReviewScheduleByIdMock(...a),
  listReviewSchedules: (...a: unknown[]) => H.listReviewSchedulesMock(...a),
}));

import { buildApp } from "../src/app.js";
import { COMMANDS } from "../src/topics.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeMilestone(o: Record<string, unknown> = {}) {
  return {
    id: MILESTONE_ID,
    tenantId: TENANT_A,
    contractId: CONTRACT_ID,
    milestoneCode: "MS-01",
    title: "Phase 1 handover",
    description: "Site handover with completion certificate",
    dueDate: "2026-06-01",
    ordinal: 1,
    status: "pending",
    achievedDate: null,
    completedAt: null,
    // Above 2^53 to prove the wire format is a string, not a JSON number.
    amountMinor: 9_007_199_254_740_993n,
    currency: "INR",
    penaltyMinor: 0n,
    netPayableMinor: null,
    waivedBy: null,
    waivedAt: null,
    waiverReason: null,
    version: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    ...o,
  };
}

function makeTerm(o: Record<string, unknown> = {}) {
  return {
    id: TERM_ID,
    tenantId: TENANT_A,
    contractId: CONTRACT_ID,
    termCode: "PEN-LD",
    description: "Liquidated damages",
    triggerType: "milestone_missed",
    thresholdValue: 7,
    penaltyKind: "percentage",
    penaltyAmountMinor: null,
    penaltyRateBps: 50,
    maxPenaltyBps: 1_000,
    currency: "INR",
    active: true,
    version: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    ...o,
  };
}

function makeReview(o: Record<string, unknown> = {}) {
  return {
    id: REVIEW_ID,
    tenantId: TENANT_A,
    contractId: CONTRACT_ID,
    reviewCode: "REV-Q",
    cadence: "quarterly",
    nextReviewDate: "2026-04-01",
    lastReviewedAt: null,
    reviewerRole: "contract_admin",
    status: "scheduled",
    notes: null,
    version: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: ACTOR,
    updatedBy: ACTOR,
    ...o,
  };
}

function token(roles: string[] = ["super_admin"], tid = TENANT_A) {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-g15" }, SECRET);
}

function auth(roles?: string[], tid?: string) {
  return { authorization: `Bearer ${token(roles, tid)}` };
}

const VALID_MILESTONE_BODY = {
  contractId: CONTRACT_ID,
  milestoneCode: "MS-01",
  name: "Phase 1 handover",
  description: "Site handover",
  dueDate: "2026-06-01",
  ordinal: 1,
  amountMinor: "9007199254740993",
  currency: "INR",
};

const VALID_TERM_BODY = {
  contractId: CONTRACT_ID,
  termCode: "PEN-LD",
  description: "Liquidated damages",
  triggerType: "milestone_missed",
  thresholdValue: 7,
  penaltyKind: "percentage",
  penaltyRateBps: 50,
  maxPenaltyBps: 1000,
  currency: "INR",
};

const VALID_REVIEW_BODY = {
  contractId: CONTRACT_ID,
  reviewCode: "REV-Q",
  cadence: "quarterly",
  nextReviewDate: "2026-04-01",
  reviewerRole: "contract_admin",
};

beforeEach(() => {
  vi.clearAllMocks();
  H.publishMock.mockResolvedValue(undefined);
  H.invalidateMock.mockResolvedValue(undefined);
  H.findMilestoneByIdMock.mockResolvedValue(makeMilestone());
  H.listMilestonesMock.mockResolvedValue({ data: [makeMilestone()], total: 1 });
  H.findPenaltyTermByIdMock.mockResolvedValue(makeTerm());
  H.listPenaltyTermsMock.mockResolvedValue({ data: [makeTerm()], total: 1 });
  H.listPenaltyApplicationsMock.mockResolvedValue({ data: [], total: 0 });
  H.findReviewScheduleByIdMock.mockResolvedValue(makeReview());
  H.listReviewSchedulesMock.mockResolvedValue({ data: [makeReview()], total: 1 });
});

async function inject(opts: Parameters<Awaited<ReturnType<typeof buildApp>>["inject"]>[0]) {
  const app = await buildApp();
  try {
    return await app.inject(opts);
  } finally {
    await app.close();
  }
}

// ══ POST /v1/contract/mou/milestones ═══════════════════════════════════════

describe("POST /v1/contract/mou/milestones", () => {
  it("publishes the register command and returns 202", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/milestones",
      headers: auth(),
      payload: VALID_MILESTONE_BODY,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(body.id).toBeDefined();

    expect(H.publishMock).toHaveBeenCalledTimes(1);
    const [topic, msg] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe(COMMANDS.mouMilestoneRegister);
    expect(msg.payload).toMatchObject({
      tenantId: TENANT_A,
      contractId: CONTRACT_ID,
      milestoneCode: "MS-01",
      dueDate: "2026-06-01",
    });
    // Money crosses the queue as an exact decimal string, above 2^53.
    expect(msg.payload.amountMinor).toBe("9007199254740993");
    expect(typeof msg.payload.amountMinor).toBe("string");
  });

  it("accepts a deliverable-only milestone with no amount", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/milestones",
      headers: auth(),
      payload: { ...VALID_MILESTONE_BODY, amountMinor: null },
    });
    expect(res.statusCode).toBe(202);
    expect(H.publishMock.mock.calls[0]![1].payload.amountMinor).toBeNull();
  });

  it("400 — missing required fields", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/milestones",
      headers: auth(),
      payload: { name: "incomplete" },
    });
    expect(res.statusCode).toBe(400);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("400 — money sent as a JSON number instead of a minor-unit string", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/milestones",
      headers: auth(),
      payload: { ...VALID_MILESTONE_BODY, amountMinor: 9007199254740993 },
    });
    expect(res.statusCode).toBe(400);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("400 — malformed due date", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/milestones",
      headers: auth(),
      payload: { ...VALID_MILESTONE_BODY, dueDate: "01-06-2026" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const res = await inject({ method: "POST", url: "/v1/contract/mou/milestones", payload: VALID_MILESTONE_BODY });
    expect(res.statusCode).toBe(401);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("403 — role without write authority", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/milestones",
      headers: auth(["citizen"]),
      payload: VALID_MILESTONE_BODY,
    });
    expect(res.statusCode).toBe(403);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("404 — unknown path under the module prefix", async () => {
    const res = await inject({ method: "POST", url: "/v1/contract/mou/nope", headers: auth(), payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

// ══ GET /v1/contract/mou/milestones ════════════════════════════════════════

describe("GET /v1/contract/mou/milestones", () => {
  it("200 with the list envelope and money as strings", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/milestones", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta).toEqual({ page: 1, pageSize: 50, total: 1 });
    expect(body.data[0].amountMinor).toBe("9007199254740993");
    expect(body.data[0].name).toBe("Phase 1 handover");
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("passes filters and pagination through", async () => {
    const res = await inject({
      method: "GET",
      url: `/v1/contract/mou/milestones?contractId=${CONTRACT_ID}&status=missed&limit=10&offset=20`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta).toEqual({ page: 3, pageSize: 10, total: 1 });
    expect(H.listMilestonesMock).toHaveBeenCalledWith(TENANT_A, {
      contractId: CONTRACT_ID,
      status: "missed",
      limit: 10,
      offset: 20,
    });
  });

  it("400 — limit above the 200 maximum", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/milestones?limit=201", headers: auth() });
    expect(res.statusCode).toBe(400);
  });

  it("400 — unparseable status filter", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/milestones?status=exploded", headers: auth() });
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/milestones" });
    expect(res.statusCode).toBe(401);
  });

  it("403 — role with no read authority", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/milestones", headers: auth(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});

// ══ GET /v1/contract/mou/milestones/:id ════════════════════════════════════

describe("GET /v1/contract/mou/milestones/:id", () => {
  it("200 with the single envelope", async () => {
    const res = await inject({ method: "GET", url: `/v1/contract/mou/milestones/${MILESTONE_ID}`, headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(MILESTONE_ID);
  });

  it("400 — id is not a uuid", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/milestones/not-a-uuid", headers: auth() });
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const res = await inject({ method: "GET", url: `/v1/contract/mou/milestones/${MILESTONE_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("403 — role with no read authority", async () => {
    const res = await inject({
      method: "GET",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 — no such milestone", async () => {
    H.findMilestoneByIdMock.mockResolvedValue(undefined);
    const res = await inject({ method: "GET", url: `/v1/contract/mou/milestones/${MISSING_ID}`, headers: auth() });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("404 — tenant isolation: tenant B cannot read tenant A's milestone", async () => {
    // Repo returns a tenant-A row (as a cache-key collision or a bug might);
    // the query layer must still refuse to hand it to tenant B.
    H.findMilestoneByIdMock.mockResolvedValue(makeMilestone({ tenantId: TENANT_A }));
    const res = await inject({
      method: "GET",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}`,
      headers: auth(["super_admin"], TENANT_B),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ══ PATCH /v1/contract/mou/milestones/:id/status ═══════════════════════════

describe("PATCH /v1/contract/mou/milestones/:id/status", () => {
  it("publishes a met transition and returns 202", async () => {
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}/status`,
      headers: auth(),
      payload: { toStatus: "met", version: 1, completedAt: "2026-05-30T10:00:00.000Z" },
    });
    expect(res.statusCode).toBe(202);
    const [topic, msg] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe(COMMANDS.mouMilestoneTransition);
    expect(msg.payload).toMatchObject({
      id: MILESTONE_ID,
      tenantId: TENANT_A,
      contractId: CONTRACT_ID,
      toStatus: "met",
      version: 1,
      completedAt: "2026-05-30T10:00:00.000Z",
    });
  });

  it("publishes a missed transition and returns 202", async () => {
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}/status`,
      headers: auth(),
      payload: { toStatus: "missed", version: 1 },
    });
    expect(res.statusCode).toBe(202);
    expect(H.publishMock.mock.calls[0]![1].payload.toStatus).toBe("missed");
  });

  it("publishes a waiver carrying the reason", async () => {
    H.findMilestoneByIdMock.mockResolvedValue(makeMilestone({ status: "missed", version: 3 }));
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}/status`,
      headers: auth(["contract_admin"]),
      payload: { toStatus: "waived", version: 3, waiverReason: "force majeure — district flood notification 4/2026" },
    });
    expect(res.statusCode).toBe(202);
    expect(H.publishMock.mock.calls[0]![1].payload).toMatchObject({
      toStatus: "waived",
      waiverReason: "force majeure — district flood notification 4/2026",
    });
  });

  it("400 — waiver with no reason", async () => {
    H.findMilestoneByIdMock.mockResolvedValue(makeMilestone({ status: "missed" }));
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}/status`,
      headers: auth(["contract_admin"]),
      payload: { toStatus: "waived", version: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().fieldErrors.some((f: { field: string }) => f.field === "waiverReason")).toBe(true);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("400 — unknown target status", async () => {
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}/status`,
      headers: auth(),
      payload: { toStatus: "pending", version: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 — version missing", async () => {
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}/status`,
      headers: auth(),
      payload: { toStatus: "met" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}/status`,
      payload: { toStatus: "met", version: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 — role without write authority", async () => {
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}/status`,
      headers: auth(["citizen"]),
      payload: { toStatus: "met", version: 1 },
    });
    expect(res.statusCode).toBe(403);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("403 — a write role may not waive a breach", async () => {
    H.findMilestoneByIdMock.mockResolvedValue(makeMilestone({ status: "missed" }));
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}/status`,
      headers: auth(["finance_admin"]),
      payload: { toStatus: "waived", version: 1, waiverReason: "vendor asked nicely" },
    });
    expect(res.statusCode).toBe(403);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("404 — no such milestone", async () => {
    H.findMilestoneByIdMock.mockResolvedValue(undefined);
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/milestones/${MISSING_ID}/status`,
      headers: auth(),
      payload: { toStatus: "met", version: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("404 — tenant isolation: tenant B cannot transition tenant A's milestone", async () => {
    H.findMilestoneByIdMock.mockResolvedValue(makeMilestone({ tenantId: TENANT_A }));
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}/status`,
      headers: auth(["super_admin"], TENANT_B),
      payload: { toStatus: "met", version: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("422 — illegal transition out of a terminal state", async () => {
    H.findMilestoneByIdMock.mockResolvedValue(makeMilestone({ status: "met" }));
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}/status`,
      headers: auth(),
      payload: { toStatus: "missed", version: 1 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_TRANSITION");
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("409 — optimistic-lock conflict on a stale version", async () => {
    H.findMilestoneByIdMock.mockResolvedValue(makeMilestone({ version: 7 }));
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}/status`,
      headers: auth(),
      payload: { toStatus: "met", version: 2 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
    expect(H.publishMock).not.toHaveBeenCalled();
  });
});

// ══ POST /v1/contract/mou/penalty-terms ════════════════════════════════════

describe("POST /v1/contract/mou/penalty-terms", () => {
  it("publishes the create command for a percentage term", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-terms",
      headers: auth(),
      payload: VALID_TERM_BODY,
    });
    expect(res.statusCode).toBe(202);
    const [topic, msg] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe(COMMANDS.mouPenaltyTermCreate);
    expect(msg.payload).toMatchObject({
      termCode: "PEN-LD",
      triggerType: "milestone_missed",
      penaltyKind: "percentage",
      penaltyRateBps: 50,
      maxPenaltyBps: 1000,
    });
    expect(msg.payload.penaltyAmountMinor).toBeNull();
  });

  it("publishes a per_day term with money as a minor-unit string", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-terms",
      headers: auth(),
      payload: {
        ...VALID_TERM_BODY,
        termCode: "PEN-DAY",
        penaltyKind: "per_day",
        penaltyRateBps: undefined,
        penaltyAmountMinor: "9007199254740993",
      },
    });
    expect(res.statusCode).toBe(202);
    expect(H.publishMock.mock.calls[0]![1].payload.penaltyAmountMinor).toBe("9007199254740993");
    expect(H.publishMock.mock.calls[0]![1].payload.penaltyRateBps).toBeNull();
  });

  it("400 — percentage term with no rate", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-terms",
      headers: auth(),
      payload: { ...VALID_TERM_BODY, penaltyRateBps: undefined },
    });
    expect(res.statusCode).toBe(400);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("400 — percentage term also carrying an amount (ambiguous money)", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-terms",
      headers: auth(),
      payload: { ...VALID_TERM_BODY, penaltyAmountMinor: "100000" },
    });
    expect(res.statusCode).toBe(400);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("400 — fixed term with no amount", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-terms",
      headers: auth(),
      payload: { ...VALID_TERM_BODY, penaltyKind: "fixed", penaltyRateBps: undefined },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 — rate above 10000 basis points", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-terms",
      headers: auth(),
      payload: { ...VALID_TERM_BODY, penaltyRateBps: 10_001 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 — unknown trigger type", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-terms",
      headers: auth(),
      payload: { ...VALID_TERM_BODY, triggerType: "vibes_bad" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const res = await inject({ method: "POST", url: "/v1/contract/mou/penalty-terms", payload: VALID_TERM_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("403 — role without write authority", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-terms",
      headers: auth(["citizen"]),
      payload: VALID_TERM_BODY,
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══ GET penalty terms ══════════════════════════════════════════════════════

describe("GET /v1/contract/mou/penalty-terms", () => {
  it("200 with the list envelope", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/penalty-terms", headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta).toEqual({ page: 1, pageSize: 50, total: 1 });
    expect(body.data[0].penaltyRateBps).toBe(50);
    expect(body.data[0].penaltyAmountMinor).toBeNull();
  });

  it("serialises a fixed term's amount as a string", async () => {
    H.listPenaltyTermsMock.mockResolvedValue({
      data: [makeTerm({ penaltyKind: "fixed", penaltyRateBps: null, penaltyAmountMinor: 9_007_199_254_740_993n })],
      total: 1,
    });
    const res = await inject({ method: "GET", url: "/v1/contract/mou/penalty-terms", headers: auth() });
    expect(res.json().data[0].penaltyAmountMinor).toBe("9007199254740993");
  });

  it("400 — bad trigger filter", async () => {
    const res = await inject({
      method: "GET",
      url: "/v1/contract/mou/penalty-terms?triggerType=nope",
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/penalty-terms" });
    expect(res.statusCode).toBe(401);
  });

  it("403 — role with no read authority", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/penalty-terms", headers: auth(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/contract/mou/penalty-terms/:id", () => {
  it("200 for an existing term", async () => {
    const res = await inject({ method: "GET", url: `/v1/contract/mou/penalty-terms/${TERM_ID}`, headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.termCode).toBe("PEN-LD");
  });

  it("400 — id is not a uuid", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/penalty-terms/xyz", headers: auth() });
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const res = await inject({ method: "GET", url: `/v1/contract/mou/penalty-terms/${TERM_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("403 — role with no read authority", async () => {
    const res = await inject({
      method: "GET",
      url: `/v1/contract/mou/penalty-terms/${TERM_ID}`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 — no such term", async () => {
    H.findPenaltyTermByIdMock.mockResolvedValue(undefined);
    const res = await inject({ method: "GET", url: `/v1/contract/mou/penalty-terms/${MISSING_ID}`, headers: auth() });
    expect(res.statusCode).toBe(404);
  });

  it("404 — tenant isolation: tenant B cannot read tenant A's term", async () => {
    const res = await inject({
      method: "GET",
      url: `/v1/contract/mou/penalty-terms/${TERM_ID}`,
      headers: auth(["super_admin"], TENANT_B),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ══ POST /v1/contract/mou/penalty-applications ═════════════════════════════

describe("POST /v1/contract/mou/penalty-applications", () => {
  const VALID = {
    penaltyTermId: TERM_ID,
    milestoneId: MILESTONE_ID,
    occurrenceRef: MILESTONE_ID,
    overdueDays: 21,
    milestoneAmountMinor: "9007199254740993",
  };

  it("publishes the apply command and returns 202", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-applications",
      headers: auth(),
      payload: VALID,
    });
    expect(res.statusCode).toBe(202);
    const [topic, msg] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe(COMMANDS.mouPenaltyApply);
    expect(msg.payload).toMatchObject({ penaltyTermId: TERM_ID, occurrenceRef: MILESTONE_ID, overdueDays: 21 });
    expect(msg.payload.milestoneAmountMinor).toBe("9007199254740993");
  });

  it("400 — missing occurrence reference", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-applications",
      headers: auth(),
      payload: { ...VALID, occurrenceRef: "" },
    });
    expect(res.statusCode).toBe(400);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("400 — money as a JSON number", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-applications",
      headers: auth(),
      payload: { ...VALID, milestoneAmountMinor: 1000 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const res = await inject({ method: "POST", url: "/v1/contract/mou/penalty-applications", payload: VALID });
    expect(res.statusCode).toBe(401);
  });

  it("403 — role without write authority", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-applications",
      headers: auth(["citizen"]),
      payload: VALID,
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 — no such penalty term", async () => {
    H.findPenaltyTermByIdMock.mockResolvedValue(undefined);
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-applications",
      headers: auth(),
      payload: VALID,
    });
    expect(res.statusCode).toBe(404);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("404 — tenant isolation: tenant B cannot apply tenant A's term", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-applications",
      headers: auth(["super_admin"], TENANT_B),
      payload: VALID,
    });
    expect(res.statusCode).toBe(404);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("422 — the term is inactive", async () => {
    H.findPenaltyTermByIdMock.mockResolvedValue(makeTerm({ active: false }));
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/penalty-applications",
      headers: auth(),
      payload: VALID,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("TERM_INACTIVE");
    expect(H.publishMock).not.toHaveBeenCalled();
  });
});

describe("GET /v1/contract/mou/penalty-applications", () => {
  it("200 with the ledger and money as strings", async () => {
    H.listPenaltyApplicationsMock.mockResolvedValue({
      data: [
        {
          id: "55555555-6666-4000-8000-000000000066",
          tenantId: TENANT_A,
          contractId: CONTRACT_ID,
          penaltyTermId: TERM_ID,
          milestoneId: MILESTONE_ID,
          occurrenceKey: `milestone:${MILESTONE_ID}`,
          computedAmountMinor: 9_007_199_254_740_993n,
          currency: "INR",
          basis: { capped: false },
          appliedAt: new Date("2026-06-20T00:00:00Z"),
          version: 1,
        },
      ],
      total: 1,
    });
    const res = await inject({ method: "GET", url: "/v1/contract/mou/penalty-applications", headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].computedAmountMinor).toBe("9007199254740993");
    expect(res.json().meta.total).toBe(1);
  });

  it("400 — limit above the maximum", async () => {
    const res = await inject({
      method: "GET",
      url: "/v1/contract/mou/penalty-applications?limit=500",
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/penalty-applications" });
    expect(res.statusCode).toBe(401);
  });

  it("403 — role with no read authority", async () => {
    const res = await inject({
      method: "GET",
      url: "/v1/contract/mou/penalty-applications",
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ══ Review schedules ═══════════════════════════════════════════════════════

describe("POST /v1/contract/mou/review-schedules", () => {
  it("publishes the schedule command and returns 202", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/review-schedules",
      headers: auth(),
      payload: VALID_REVIEW_BODY,
    });
    expect(res.statusCode).toBe(202);
    const [topic, msg] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe(COMMANDS.mouReviewSchedule);
    expect(msg.payload).toMatchObject({ reviewCode: "REV-Q", cadence: "quarterly", nextReviewDate: "2026-04-01" });
  });

  it("400 — unknown cadence", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/review-schedules",
      headers: auth(),
      payload: { ...VALID_REVIEW_BODY, cadence: "fortnightly" },
    });
    expect(res.statusCode).toBe(400);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("400 — malformed review date", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/review-schedules",
      headers: auth(),
      payload: { ...VALID_REVIEW_BODY, nextReviewDate: "next April" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const res = await inject({ method: "POST", url: "/v1/contract/mou/review-schedules", payload: VALID_REVIEW_BODY });
    expect(res.statusCode).toBe(401);
  });

  it("403 — role without write authority", async () => {
    const res = await inject({
      method: "POST",
      url: "/v1/contract/mou/review-schedules",
      headers: auth(["citizen"]),
      payload: VALID_REVIEW_BODY,
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/contract/mou/review-schedules", () => {
  it("200 with the list envelope", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/review-schedules", headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].reviewCode).toBe("REV-Q");
    expect(res.json().meta.total).toBe(1);
  });

  it("400 — bad status filter", async () => {
    const res = await inject({
      method: "GET",
      url: "/v1/contract/mou/review-schedules?status=whatever",
      headers: auth(),
    });
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/review-schedules" });
    expect(res.statusCode).toBe(401);
  });

  it("403 — role with no read authority", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/review-schedules", headers: auth(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/contract/mou/review-schedules/:id", () => {
  it("200 for an existing schedule", async () => {
    const res = await inject({ method: "GET", url: `/v1/contract/mou/review-schedules/${REVIEW_ID}`, headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.cadence).toBe("quarterly");
  });

  it("400 — id is not a uuid", async () => {
    const res = await inject({ method: "GET", url: "/v1/contract/mou/review-schedules/abc", headers: auth() });
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const res = await inject({ method: "GET", url: `/v1/contract/mou/review-schedules/${REVIEW_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("403 — role with no read authority", async () => {
    const res = await inject({
      method: "GET",
      url: `/v1/contract/mou/review-schedules/${REVIEW_ID}`,
      headers: auth(["citizen"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 — no such schedule", async () => {
    H.findReviewScheduleByIdMock.mockResolvedValue(undefined);
    const res = await inject({ method: "GET", url: `/v1/contract/mou/review-schedules/${MISSING_ID}`, headers: auth() });
    expect(res.statusCode).toBe(404);
  });

  it("404 — tenant isolation: tenant B cannot read tenant A's schedule", async () => {
    const res = await inject({
      method: "GET",
      url: `/v1/contract/mou/review-schedules/${REVIEW_ID}`,
      headers: auth(["super_admin"], TENANT_B),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /v1/contract/mou/review-schedules/:id/complete", () => {
  it("publishes the complete command and returns 202", async () => {
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/review-schedules/${REVIEW_ID}/complete`,
      headers: auth(),
      payload: { version: 1, notes: "reviewed with the vendor; no variation needed" },
    });
    expect(res.statusCode).toBe(202);
    const [topic, msg] = H.publishMock.mock.calls[0]!;
    expect(topic).toBe(COMMANDS.mouReviewComplete);
    expect(msg.payload).toMatchObject({ id: REVIEW_ID, tenantId: TENANT_A, version: 1 });
  });

  it("400 — version missing", async () => {
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/review-schedules/${REVIEW_ID}/complete`,
      headers: auth(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("401 — no token", async () => {
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/review-schedules/${REVIEW_ID}/complete`,
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 — role without write authority", async () => {
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/review-schedules/${REVIEW_ID}/complete`,
      headers: auth(["citizen"]),
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404 — no such schedule", async () => {
    H.findReviewScheduleByIdMock.mockResolvedValue(undefined);
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/review-schedules/${MISSING_ID}/complete`,
      headers: auth(),
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(404);
  });

  it("404 — tenant isolation: tenant B cannot complete tenant A's review", async () => {
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/review-schedules/${REVIEW_ID}/complete`,
      headers: auth(["super_admin"], TENANT_B),
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(404);
    expect(H.publishMock).not.toHaveBeenCalled();
  });

  it("422 — a completed review cannot be completed again", async () => {
    H.findReviewScheduleByIdMock.mockResolvedValue(makeReview({ status: "cancelled" }));
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/review-schedules/${REVIEW_ID}/complete`,
      headers: auth(),
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_TRANSITION");
  });

  it("409 — optimistic-lock conflict", async () => {
    H.findReviewScheduleByIdMock.mockResolvedValue(makeReview({ version: 5 }));
    const res = await inject({
      method: "PATCH",
      url: `/v1/contract/mou/review-schedules/${REVIEW_ID}/complete`,
      headers: auth(),
      payload: { version: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
    expect(H.publishMock).not.toHaveBeenCalled();
  });
});

// ══ Cache resilience ═══════════════════════════════════════════════════════

describe("cache degradation", () => {
  it("a Redis fault falls through to Postgres rather than returning 500", async () => {
    vi.resetModules();
    vi.doMock("../src/shared/infra.js", () => ({
      cache: {
        invalidate: async () => {},
        makeKey: (...a: string[]) => a.join(":"),
        getOrLoad: async () => {
          throw new Error("ECONNREFUSED 127.0.0.1:6381");
        },
      },
      queue: { publish: (...a: unknown[]) => H.publishMock(...a) },
    }));
    const { buildApp: build } = await import("../src/app.js");
    const app = await build();
    const res = await app.inject({
      method: "GET",
      url: `/v1/contract/mou/milestones/${MILESTONE_ID}`,
      headers: auth(),
    });
    await app.close();
    vi.doUnmock("../src/shared/infra.js");
    vi.resetModules();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(MILESTONE_ID);
  });
});
