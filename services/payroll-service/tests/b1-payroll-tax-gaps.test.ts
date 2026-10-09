/**
 * Gap batch b1-payroll-tax — route-level regression tests.
 *
 * Exercises the real Fastify app (auth plugin, JWT, error handler) with the
 * read side (scopedRead), the queue and the HRMS client mocked, so each test
 * pins one behaviour without needing seeded rows:
 *
 *   GAP-PAYROLL-CORRECTIONS-01      approve/reject maker-checker endpoints
 *   GAP-PAYROLL-OFF-CYCLE-01        process: creator 403, non-draft 409
 *   GAP-PAYROLL-STATUTORY-PT-03     overlapping PT slab 422, upsert keeps others
 *   GAP-PAYROLL-STATUTORY-LWF-02    lwfFrequency accepted / validated
 *   GAP-PAYROLL-STATUTORY-CHALLANS-01 duplicate CIN 409
 *   GAP-PAYROLL-STATUTORY-PF-02     ECR generation emits an audit event
 *   GAP-PAYROLL-RETURNS-06          24Q carries exact paise fields
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const TENANT = "bbbbbbbb-0b10-4000-8000-000000000b10";
const MAKER = "00000000-0b10-4000-8000-00000000000a";
const CHECKER = "00000000-0b10-4000-8000-00000000000b";
const ROW_ID = "00000000-0b10-4000-8000-0000000000c1";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function tok(sub: string, roles: string[] = ["payroll_admin"]): string {
  return signToken({ sub, tid: TENANT, roles, sid: `sess-${sub}` }, SECRET);
}

// scopedRead returns whatever the test queued, in call order.
const readQueue: unknown[] = [];
vi.mock("../src/shared/db.js", async () => {
  const actual = await vi.importActual<typeof import("../src/shared/db.js")>("../src/shared/db.js");
  return {
    ...actual,
    scopedRead: vi.fn(async () => {
      if (readQueue.length === 0) throw new Error("unexpected scopedRead");
      return readQueue.shift();
    }),
  };
});

const mockPublish = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...a: unknown[]) => mockPublish(...a), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn(), ping: vi.fn() },
  cache: {
    getOrLoad: vi.fn((_k: string, fn: () => unknown) => fn()),
    invalidate: vi.fn(),
    invalidateResource: vi.fn(),
    makeKey: (...parts: string[]) => parts.join(":"),
    put: vi.fn(),
    ping: vi.fn(),
  },
}));

const mockFetchPayrollInput = vi.fn();
vi.mock("../src/shared/hrms-client.js", async () => {
  const actual = await vi.importActual<typeof import("../src/shared/hrms-client.js")>("../src/shared/hrms-client.js");
  return {
    ...actual,
    fetchPayrollInput: (...a: unknown[]) => mockFetchPayrollInput(...a),
    fetchEmployeeSummaries: vi.fn(async () => new Map()),
  };
});

// 24Q's TRACES reconciliation gate is covered by its own suites; pin it to
// "matched" here so this test isolates the money fields.
vi.mock("../src/modules/statutory-returns/challan-routes.js", async () => {
  const actual = await vi.importActual<typeof import("../src/modules/statutory-returns/challan-routes.js")>("../src/modules/statutory-returns/challan-routes.js");
  return {
    ...actual,
    reconcilePeriod: vi.fn(async (tenantId: string, period: string, formType = "24Q") => ({
      tenantId, period, formType, tdsDeductedMinor: "0", tdsDepositedMinor: "0", varianceMinor: "0",
      matched: true, challanCount: 1, status: "matched",
    })),
  };
});

const { buildApp } = await import("../src/app.js");
const { COMMANDS } = await import("../src/topics.js");
const app = await buildApp();
afterAll(async () => { await app.close(); });

beforeEach(() => {
  readQueue.length = 0;
  mockPublish.mockClear();
  mockFetchPayrollInput.mockReset();
});

function post(url: string, sub: string, payload: unknown = {}, roles?: string[]) {
  return app.inject({
    method: "POST", url,
    headers: { authorization: `Bearer ${tok(sub, roles)}`, "content-type": "application/json" },
    payload: payload as Record<string, unknown>,
  });
}

describe("GAP-PAYROLL-CORRECTIONS-01: correction approve/reject", () => {
  it("rejects the maker approving their own correction with 403 and publishes nothing", async () => {
    readQueue.push([{ status: "pending", created_by: MAKER }]);
    const r = await post(`/v1/payroll/corrections/${ROW_ID}/approve`, MAKER);
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SELF_APPROVAL_FORBIDDEN");
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("lets a different payroll user approve: 202 + correctionDecide command", async () => {
    readQueue.push([{ status: "pending", created_by: MAKER }]);
    const r = await post(`/v1/payroll/corrections/${ROW_ID}/approve`, CHECKER, { note: "verified against order" });
    expect(r.statusCode).toBe(202);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [topic, msg] = mockPublish.mock.calls[0] as [string, { actorId: string; payload: { id: string; decision: string } }];
    expect(topic).toBe(COMMANDS.correctionDecide);
    expect(msg.actorId).toBe(CHECKER);
    expect(msg.payload).toMatchObject({ id: ROW_ID, decision: "approved" });
  });

  it("returns 409 for an already-decided correction", async () => {
    readQueue.push([{ status: "approved", created_by: MAKER }]);
    const r = await post(`/v1/payroll/corrections/${ROW_ID}/reject`, CHECKER, { note: "dup" });
    expect(r.statusCode).toBe(409);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("requires a reason to reject", async () => {
    const r = await post(`/v1/payroll/corrections/${ROW_ID}/reject`, CHECKER, {});
    expect(r.statusCode).toBe(400);
  });

  it("returns 404 for an unknown correction and 403 for a non-payroll role", async () => {
    readQueue.push([]);
    expect((await post(`/v1/payroll/corrections/${ROW_ID}/approve`, CHECKER)).statusCode).toBe(404);
    expect((await post(`/v1/payroll/corrections/${ROW_ID}/approve`, CHECKER, {}, ["employee"])).statusCode).toBe(403);
  });
});

describe("GAP-PAYROLL-OFF-CYCLE-01: off-cycle process maker-checker", () => {
  it("creator processing their own draft run gets 403", async () => {
    readQueue.push([{ status: "draft", created_by: MAKER, has_items: true }]);
    const r = await post(`/v1/payroll/off-cycle/${ROW_ID}/process`, MAKER);
    expect(r.statusCode).toBe(403);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("processing a run that is not draft gets 409", async () => {
    readQueue.push([{ status: "processed", created_by: MAKER, has_items: true }]);
    const r = await post(`/v1/payroll/off-cycle/${ROW_ID}/process`, CHECKER);
    expect(r.statusCode).toBe(409);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("a different payroll user processes a draft run: 202", async () => {
    readQueue.push([{ status: "draft", created_by: MAKER, has_items: true }]);
    // GAP-PAYROLL-OFF-CYCLE-04 (b3): processing also requires a reason.
    const r = await post(`/v1/payroll/off-cycle/${ROW_ID}/process`, CHECKER, { reason: "Quarterly incentive approved by DDO" });
    expect(r.statusCode).toBe(202);
    expect(mockPublish.mock.calls[0]![0]).toBe(COMMANDS.offCycleProcess);
  });
});

describe("GAP-PAYROLL-STATUTORY-PT-04 / LWF-02: state rules", () => {
  it("refuses PT slabs on state-rules with 422 -- they are versioned now", async () => {
    const r = await post("/v1/payroll/statutory/state-rules", MAKER, {
      stateCode: "KA", ptSlabs: [{ fromMinor: 1500001, toMinor: 999999999999, taxMinor: 25000 }],
    });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("PT_SLABS_USE_VERSIONS");
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("accepts an LWF frequency and rejects an unknown one", async () => {
    const ok = await post("/v1/payroll/statutory/state-rules", MAKER, {
      stateCode: "MH", lwfEmployee: 2500, lwfEmployer: 7500, lwfFrequency: "half_yearly",
    });
    expect(ok.statusCode).toBe(202);
    expect((mockPublish.mock.calls[0]![1] as { payload: { lwfFrequency: string } }).payload.lwfFrequency).toBe("half_yearly");
    const bad = await post("/v1/payroll/statutory/state-rules", MAKER, { stateCode: "MH", lwfFrequency: "weekly" });
    expect(bad.statusCode).toBe(400);
  });
});

describe("GAP-PAYROLL-STATUTORY-CHALLANS-01: duplicate challan", () => {
  const body = {
    period: "2026-08", bsrCode: "0510308", challanSerial: "123",
    depositDate: "2026-09-07", tdsAmount: 35000,
  };
  it("returns 409 DUPLICATE_CHALLAN when the CIN is already recorded", async () => {
    readQueue.push([{ cin: "05103080709202600123" }]);
    const r = await post("/v1/payroll/statutory/challans", MAKER, body);
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("DUPLICATE_CHALLAN");
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("accepts a new CIN with 202", async () => {
    readQueue.push([]);
    const r = await post("/v1/payroll/statutory/challans", MAKER, body);
    expect(r.statusCode).toBe(202);
  });
});

describe("GAP2-PAYROLL-STATUTORY-CHALLANS-01: TDS challan money is bigint paise end to end", () => {
  const base = { period: "2026-08", bsrCode: "0510308", challanSerial: "456", depositDate: "2026-09-07" };

  it("forwards the exact paise from tdsAmountMinor without any float rounding", async () => {
    readQueue.push([]); // no duplicate CIN
    const r = await post("/v1/payroll/statutory/challans", MAKER, { ...base, tdsAmountMinor: "12345600" });
    expect(r.statusCode).toBe(202);
    const cmd = mockPublish.mock.calls.find((c) => (c[1] as { payload?: { tdsAmountMinor?: string } })?.payload?.tdsAmountMinor != null);
    expect(cmd).toBeDefined();
    const payload = (cmd![1] as { payload: { tdsAmountMinor: string; totalAmountMinor: string } }).payload;
    // Exact integer paise, byte-for-byte — not 12345600.000001 or similar.
    expect(payload.tdsAmountMinor).toBe("12345600");
    expect(payload.totalAmountMinor).toBe("12345600");
  });

  it("rejects a non-integer (sub-paise) tdsAmountMinor with 400", async () => {
    const r = await post("/v1/payroll/statutory/challans", MAKER, { ...base, challanSerial: "457", tdsAmountMinor: "123.45" });
    expect(r.statusCode).toBe(400);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("requires at least one of tdsAmountMinor / tdsAmount", async () => {
    const r = await post("/v1/payroll/statutory/challans", MAKER, { ...base, challanSerial: "458" });
    expect(r.statusCode).toBe(400);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("still accepts the legacy rupee tdsAmount and converts it exactly to paise", async () => {
    readQueue.push([]);
    const r = await post("/v1/payroll/statutory/challans", MAKER, { ...base, challanSerial: "459", tdsAmount: 50000 });
    expect(r.statusCode).toBe(202);
    const cmd = mockPublish.mock.calls.find((c) => (c[1] as { payload?: { tdsAmountMinor?: string } })?.payload?.tdsAmountMinor != null);
    expect(cmd).toBeDefined();
    expect((cmd![1] as { payload: { tdsAmountMinor: string } }).payload.tdsAmountMinor).toBe("5000000");
  });
});

describe("GAP-PAYROLL-STATUTORY-PF-02: ECR export is audited", () => {
  it("publishes exactly one export_ecr audit event with the record count", async () => {
    readQueue.push([
      { employeeId: "e1", slipId: "s1", empContribMinor: 180000n, epsContribMinor: 125000n, epfErContribMinor: 55000n },
      { employeeId: "e2", slipId: "s2", empContribMinor: 180000n, epsContribMinor: 125000n, epfErContribMinor: 55000n },
    ]);
    readQueue.push([
      { id: "s1", grossMinor: 2000000n, basicMinor: 1500000n, components: [], employeeNo: "E1" },
      { id: "s2", grossMinor: 2000000n, basicMinor: 1500000n, components: [], employeeNo: "E2" },
    ]);
    mockFetchPayrollInput.mockResolvedValue({ employees: [{ id: "e1", uan: "100", fullName: "A" }, { id: "e2", uan: "200", fullName: "B" }] });
    const r = await app.inject({
      method: "GET", url: "/v1/payroll/statutory/ecr?month=2026-08",
      headers: { authorization: `Bearer ${tok(MAKER)}` },
    });
    expect(r.statusCode).toBe(200);
    const audits = mockPublish.mock.calls.filter((c) => c[0] === "audit.event.record");
    expect(audits).toHaveLength(1);
    const payload = (audits[0]![1] as { actorId: string; payload: { action: string; detail: { month: string; recordCount: number } } });
    expect(payload.actorId).toBe(MAKER);
    expect(payload.payload.action).toBe("export_ecr");
    expect(payload.payload.detail).toEqual({ month: "2026-08", recordCount: 2 });
  });
});

describe("GAP-PAYROLL-RETURNS-06: 24Q money is exact paise", () => {
  it("returns per-deductee and total paise fields summed without float drift", async () => {
    // reconcilePeriod is mocked to "matched" (see vi.mock above), so the
    // reads below are only the 24Q builder's own.
    const tdsRows = [
      { employeeId: "e1", runId: "run-1", period: "2026-04", tdsMinor: 3333n },
      { employeeId: "e1", runId: "run-1", period: "2026-05", tdsMinor: 3334n },
      { employeeId: "e1", runId: "run-1", period: "2026-06", tdsMinor: 3333n },
    ];
    readQueue.push([{ id: "run-1", status: "approved" }]); // deducteeWiseTds runs
    readQueue.push(tdsRows);                               // deducteeWiseTds tds
    readQueue.push([{ id: "run-1", status: "approved" }]); // challan runs
    readQueue.push(tdsRows);                               // challan tds
    readQueue.push([]);                                    // recorded filings (GAP-PAYROLL-RETURNS-01)
    readQueue.push([]);                                    // challan CINs for the quarter (challanRef)
    mockFetchPayrollInput.mockResolvedValue({ employees: [{ id: "e1", pan: "ABCDE1234F", fullName: "A" }] });

    const r = await app.inject({
      method: "GET", url: "/v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1",
      headers: { authorization: `Bearer ${tok(MAKER)}` },
    });
    if (r.statusCode !== 200) throw new Error(`24Q ${r.statusCode}: ${r.body}`);
    const body = r.json();
    expect(body.deductees[0].tdsDeductedMinor).toBe(10000);
    expect(body.deductees[0].tdsDepositedMinor).toBe(10000);
    expect(body.totalTdsDeductedMinor).toBe(10000);
    expect(body.totalTdsDepositedMinor).toBe(10000);
    expect(body.challanSummary.map((c: { tdsDepositedMinor: number }) => c.tdsDepositedMinor)).toEqual([3333, 3334, 3333]);
    // Whole-rupee fields for the TRACES file are unchanged in meaning.
    expect(body.totalTdsDeducted).toBe(100);
  });
});
