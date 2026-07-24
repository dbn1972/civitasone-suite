/**
 * Assessment consumer — coverage gaps for revise/remit/remitDecide paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMarkProcessed = vi.fn().mockResolvedValue(true);
const mockEnqueue = vi.fn().mockResolvedValue(undefined);
const mockCacheInvalidate = vi.fn().mockResolvedValue(undefined);

let txSelectResults: any[][] = [];
let txSelectCallIndex = 0;

function chainableSelect() {
  const getResult = () => txSelectResults[txSelectCallIndex++] ?? [];
  const chain: any = {
    from: vi.fn().mockImplementation(() => chain),
    where: vi.fn().mockImplementation(() => chain),
    orderBy: vi.fn().mockImplementation(() => chain),
    limit: vi.fn().mockImplementation(() => Promise.resolve(getResult())),
    then: (resolve: any) => Promise.resolve(getResult()).then(resolve),
  };
  return chain;
}

const mockInsertReturning = vi.fn().mockResolvedValue([{ id: "new-1" }]);
const mockInsertValues = vi.fn().mockReturnValue({ returning: mockInsertReturning });
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

const mockSetWhere = vi.fn().mockReturnThis();
const mockSetWhereReturning = vi.fn().mockResolvedValue([{ id: "u-1", version: 2 }]);
mockSetWhere.mockReturnValue({ returning: mockSetWhereReturning });
const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: vi.fn(async (fn: any) => fn({
      insert: (...a: any[]) => mockInsert(...a),
      select: () => chainableSelect(),
      update: (...a: any[]) => mockUpdate(...a),
    })),
    select: () => chainableSelect(),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: (...args: any[]) => mockMarkProcessed(...args),
  enqueue: (...args: any[]) => mockEnqueue(...args),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: (...args: any[]) => mockCacheInvalidate(...args), getOrLoad: vi.fn().mockResolvedValue([]) },
  queue: { subscribe: vi.fn(), publish: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...a: any[]) => a), and: vi.fn((...a: any[]) => a), desc: vi.fn(),
  sql: vi.fn().mockReturnValue({ mapWith: vi.fn().mockReturnValue("sql") }),
}));

vi.mock("../src/modules/assessment/schema.js", () => ({
  assessments: { tenantId: "t", id: "id", version: "v", assesseeId: "ai", rateHeadId: "rhi", status: "s" },
  demands: { tenantId: "t", assessmentId: "ai" },
  dcbEntries: { tenantId: "t", assesseeId: "ai", demandId: "di" },
  remissions: { tenantId: "t", assessmentId: "ai", status: "s", id: "id", makerUserId: "mu" },
}));

vi.mock("../src/modules/rate-engine/schema.js", () => ({
  rateSlabs: { tenantId: "t", rateHeadId: "rhi" },
  penaltyRules: { tenantId: "t", rateHeadId: "rhi" },
  rebateRules: { tenantId: "t", rateHeadId: "rhi" },
}));

vi.mock("../src/modules/rate-engine/domain.js", () => ({
  compute: vi.fn().mockReturnValue({
    principal: 120000n, rebate: 0n, penalty: 5000n, interest: 2000n, net: 127000n,
    snapshot: { net: "127000" },
  }),
}));

vi.mock("../src/modules/assessment/domain.js", () => ({
  assertCanRevise: vi.fn(),
  assertMakerChecker: (m: string, c: string) => { if (m === c) throw new Error("MAKER_CHECKER_VIOLATION"); },
}));

import { registerAssessmentConsumers } from "../src/modules/assessment/consumer.js";

type Handler = (msg: any) => Promise<void>;
const handlers: Record<string, Handler> = {};

function msg(overrides: any = {}) {
  return { messageId: "m-1", tenantId: "t-1", actorId: "a-1", correlationId: "c-1", payload: {}, ...overrides };
}

describe("Assessment Consumer — gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txSelectResults = [];
    txSelectCallIndex = 0;
    mockInsertReturning.mockResolvedValue([{ id: "new-1" }]);
    mockSetWhereReturning.mockResolvedValue([{ id: "u-1", version: 2 }]);
    const q = { subscribe: vi.fn((t: string, h: Handler) => { handlers[t] = h; }), publish: vi.fn(), start: vi.fn(), stop: vi.fn() } as any;
    registerAssessmentConsumers(q);
  });

  it("revise: updates assessment and recomputes demand", async () => {
    txSelectResults = [
      [{ id: "as-1", tenantId: "t-1", rateHeadId: "rh-1", status: "active", version: 1, exemptions: [], assesseeId: "ae-1" }],
      [], [], [], // slabs, penalties, rebates
    ];
    await handlers["revenue.assessment.revise"]!(msg({ payload: { assessmentId: "as-1", version: 1, reason: "Fix", newBaseValue: "1200000" } }));
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.assessment.revised");
  });

  it("remit: creates pending remission", async () => {
    await handlers["revenue.assessment.remit"]!(msg({ payload: { assessmentId: "as-1", reason: "Hard", remissionPercent: 25 } }));
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it("remitDecide approve: enqueues assessmentRemitted", async () => {
    txSelectResults = [[{ id: "rem-1", makerUserId: "maker-1", status: "pending" }]];
    await handlers["revenue.assessment.remit_decide"]!(msg({ actorId: "checker-1", payload: { assessmentId: "as-1", approve: true } }));
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.assessment.remitted");
  });

  it("remitDecide reject: only audit", async () => {
    txSelectResults = [[{ id: "rem-1", makerUserId: "maker-1", status: "pending" }]];
    await handlers["revenue.assessment.remit_decide"]!(msg({ actorId: "checker-1", payload: { assessmentId: "as-1", approve: false } }));
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0]![1].topic).toBe("audit.event.record");
  });

  it("remitDecide throws when no pending remission", async () => {
    txSelectResults = [[]];
    await expect(handlers["revenue.assessment.remit_decide"]!(msg({ actorId: "c-1", payload: { assessmentId: "as-1", approve: true } }))).rejects.toThrow("No pending remission");
  });
});
