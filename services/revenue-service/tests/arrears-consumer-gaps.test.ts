/**
 * Arrears consumer — coverage gaps for writeOffCreate/writeOffDecide paths.
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

const mockSetWhere = vi.fn().mockResolvedValue(undefined);
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

vi.mock("../src/modules/arrears/schema.js", () => ({
  instalmentPlans: { id: "id", tenantId: "t" },
  instalments: Symbol("inst"),
  writeOffs: { tenantId: "t", id: "id", assesseeId: "ai", makerUserId: "mu" },
  recoveryReferrals: Symbol("rr"),
}));

vi.mock("../src/modules/assessment/schema.js", () => ({
  dcbEntries: { tenantId: "t", assesseeId: "ai", demandId: "di", balanceMinor: "bm", entryType: "et", amountMinor: "am", createdAt: "ca" },
}));

vi.mock("../src/modules/arrears/domain.js", () => ({
  generateInstalmentSchedule: vi.fn((total: bigint, count: number) =>
    Array.from({ length: count }, (_, i) => ({ sequenceNo: i + 1, dueDate: `2025-0${i+1}-01`, amountMinor: total / BigInt(count) })),
  ),
  validateWriteOff: vi.fn(),
  assertMakerChecker: (m: string, c: string) => { if (m === c) throw new Error("MAKER_CHECKER_VIOLATION"); },
}));

import { registerArrearsConsumers } from "../src/modules/arrears/consumer.js";

type Handler = (msg: any) => Promise<void>;
const handlers: Record<string, Handler> = {};

function msg(overrides: any = {}) {
  return { messageId: "m-1", tenantId: "t-1", actorId: "a-1", correlationId: "c-1", payload: {}, ...overrides };
}

describe("Arrears Consumer — writeOffCreate/writeOffDecide gaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txSelectResults = [];
    txSelectCallIndex = 0;
    mockInsertReturning.mockResolvedValue([{ id: "plan-1" }]);
    const q = { subscribe: vi.fn((t: string, h: Handler) => { handlers[t] = h; }), publish: vi.fn(), start: vi.fn(), stop: vi.fn() } as any;
    registerArrearsConsumers(q);
  });

  it("writeOffCreate: validates and inserts pending write-off", async () => {
    txSelectResults = [[{ total: 300000n }]]; // balance query
    await handlers["revenue.write_off.create"]!(msg({ payload: { assesseeId: "ae-1", amountMinor: "100000", reason: "Bad" } }));
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0]![1].topic).toBe("audit.event.record");
  });

  it("writeOffDecide approve: inserts DCB entry and enqueues events", async () => {
    txSelectResults = [
      [{ id: "wo-1", makerUserId: "maker-1", assesseeId: "ae-1", amountMinor: 100000n, reason: "Bad" }],
      [{ total: 200000n }], // balance for DCB
    ];
    await handlers["revenue.write_off.decide"]!(msg({ actorId: "checker-1", payload: { writeOffId: "wo-1", approve: true, reason: "OK" } }));
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledTimes(2);
    expect(mockEnqueue.mock.calls[0]![1].topic).toBe("revenue.write_off.applied");
  });

  it("writeOffDecide reject: no DCB, only audit", async () => {
    txSelectResults = [[{ id: "wo-2", makerUserId: "maker-1", assesseeId: "ae-1", amountMinor: 50000n, reason: "X" }]];
    await handlers["revenue.write_off.decide"]!(msg({ actorId: "checker-1", payload: { writeOffId: "wo-2", approve: false } }));
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue.mock.calls[0]![1].topic).toBe("audit.event.record");
  });

  it("writeOffDecide: skips when write-off not found", async () => {
    txSelectResults = [[]];
    await handlers["revenue.write_off.decide"]!(msg({ actorId: "c-1", payload: { writeOffId: "nope", approve: true } }));
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
