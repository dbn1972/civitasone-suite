/**
 * GAP-PAYROLL-RETURNS-06 -- ONE money unit and ONE money type across the
 * statutory-return response family: GET form24q, POST form24q/force-file and
 * GET form26q.
 *
 * Every `*Minor` amount on those wires is an exact integer count of PAISE sent
 * as a JSON number. The 26Q used to send bigint strings while 24Q/force-file
 * sent numbers, so a client had to know which endpoint it was reading; and a
 * client that treated a rupee field as paise (or the reverse) was off by 100x.
 *
 * Fixture: TDS of Rs 35,000 == 3,500,000 paise on every endpoint.
 *
 * The read side (scopedRead), the queue, HRMS and the TRACES reconciliation
 * helpers are mocked so each test pins the money fields exactly.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const TENANT = "bbbbbbbb-0b10-4000-8000-0000000b2606";
const FILER = "00000000-0b10-4000-8000-00000000b260";
// vitest.config.ts sets JWT_SECRET for every payroll-service suite.
const SECRET = process.env.JWT_SECRET as string;
const tok = (roles: string[] = ["payroll_admin"]) => signToken({ sub: FILER, tid: TENANT, roles, sid: "sess-returns-06" }, SECRET);

const TDS_RUPEES = 35_000;
const TDS_PAISE = 3_500_000;

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

vi.mock("../src/shared/hrms-client.js", async () => {
  const actual = await vi.importActual<typeof import("../src/shared/hrms-client.js")>("../src/shared/hrms-client.js");
  return {
    ...actual,
    fetchPayrollInput: vi.fn(async () => ({ employees: [{ id: "e1", pan: "ABCDE1234F", fullName: "Asha Verma" }] })),
    fetchEmployeeSummaries: vi.fn(async () => new Map()),
  };
});

// The TRACES reconciliation helpers read their own tables; stub them. They
// return bigint-string paise (their native shape), which is what the return
// payloads must convert. `state.matched` flips the 24Q gate.
const state = vi.hoisted(() => ({ matched: true }));
vi.mock("../src/modules/statutory-returns/challan-routes.js", async () => {
  const actual = await vi.importActual<typeof import("../src/modules/statutory-returns/challan-routes.js")>("../src/modules/statutory-returns/challan-routes.js");
  const reco = (tenantId: string, period: string, formType: string) => ({
    tenantId, period, formType,
    tdsDeductedMinor: "3500000",
    tdsDepositedMinor: state.matched ? "3500000" : "3000000",
    varianceMinor: state.matched ? "0" : "-500000",
    matched: state.matched,
    challanCount: 1,
    status: state.matched ? "matched" : "shortfall",
  });
  return {
    ...actual,
    reconcilePeriod: vi.fn(async (tenantId: string, period: string, formType = "24Q") => reco(tenantId, period, formType)),
    reconcileNonSalaryPeriod: vi.fn(async (tenantId: string, period: string) => reco(tenantId, period, "26Q")),
  };
});

const { buildApp } = await import("../src/app.js");
const app = await buildApp();
afterAll(async () => { await app.close(); });

beforeEach(() => {
  readQueue.length = 0;
  mockPublish.mockClear();
  state.matched = true;
});

/** The 6 reads of a 24Q build for Q1 FY2026-27, with Rs 35,000 deducted and deposited in April. */
function queue24Q() {
  const runs = [{ id: "run-1", status: "approved" }];
  const tdsRows = [{ employeeId: "e1", runId: "run-1", period: "2026-04", tdsMinor: BigInt(TDS_PAISE) }];
  readQueue.push(runs);        // deducteeWiseTds: runs
  readQueue.push(tdsRows);     // deducteeWiseTds: tds rows
  readQueue.push(runs);        // challan summary: runs
  readQueue.push(tdsRows);     // challan summary: tds rows
  readQueue.push([]);          // recorded filings
  readQueue.push([]);          // challan CINs
}

/** The one read of a 26Q build: a Rs 10,00,000 vendor payment with Rs 35,000 TDS (paise as bigint, as the DB returns them). */
function queue26Q() {
  readQueue.push([{
    deducteeRef: "v1", deducteeName: "Vendor One", deducteePan: "AAAAA0000A", section: "194C",
    paidAmountMinor: 100_000_000n, tdsAmountMinor: BigInt(TDS_PAISE), period: "2026-04",
  }]);
}

const get = (url: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tok()}` } });
const forceFile = () => app.inject({
  method: "POST", url: "/v1/payroll/statutory/form24q/force-file",
  headers: { authorization: `Bearer ${tok()}`, "content-type": "application/json" },
  payload: { fy: "2026-27", quarter: "Q1", confirmForce: true, reason: "TRACES reconciliation pending a corrected challan" },
});

/** Every `...Minor` leaf in a payload, with its path, wherever it is nested. */
function minorLeaves(value: unknown, path = "$"): Array<{ path: string; value: unknown }> {
  if (Array.isArray(value)) return value.flatMap((v, i) => minorLeaves(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      /Minor$/.test(k) && (typeof v !== "object" || v === null)
        ? [{ path: `${path}.${k}`, value: v }]
        : minorLeaves(v, `${path}.${k}`));
  }
  return [];
}

describe("GAP-PAYROLL-RETURNS-06: Rs 35,000 TDS is 3,500,000 paise as a number on 24Q, force-file and 26Q", () => {
  it("GET form24q", async () => {
    queue24Q();
    const r = await get("/v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1");
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(b.deductees[0].tdsDeductedMinor).toBe(TDS_PAISE);
    expect(b.deductees[0].tdsDepositedMinor).toBe(TDS_PAISE);
    expect(b.totalTdsDeductedMinor).toBe(TDS_PAISE);
    expect(b.totalTdsDepositedMinor).toBe(TDS_PAISE);
    expect(b.challanSummary[0].tdsDepositedMinor).toBe(TDS_PAISE);
  });

  it("POST form24q/force-file on an UNRECONCILED quarter reports the same paise, and is still audited", async () => {
    state.matched = false;
    queue24Q();
    const r = await forceFile();
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(b.deductees[0].tdsDeductedMinor).toBe(TDS_PAISE);
    expect(b.totalTdsDeductedMinor).toBe(TDS_PAISE);
    expect(b.totalTdsDepositedMinor).toBe(TDS_PAISE);
    expect(b.reconciliation.matched).toBe(false);
    // The forced filing stays loud: one audit event carrying the exact variance.
    const audit = mockPublish.mock.calls.filter((c) => c[0] === "audit.event.record");
    expect(audit).toHaveLength(1);
    expect((audit[0]![1] as { payload: { action: string; varianceMinor: string } }).payload.action).toBe("force_file_24q");
    expect((audit[0]![1] as { payload: { varianceMinor: string } }).payload.varianceMinor).toBe("-1500000"); // 3 months x -500000
  });

  it("GET form26q", async () => {
    queue26Q();
    const r = await get("/v1/payroll/statutory/form26q?fy=2026-27&quarter=Q1");
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json();
    expect(b.deductees[0].amountPaidMinor).toBe(100_000_000);
    expect(b.deductees[0].tdsDeductedMinor).toBe(TDS_PAISE);
    expect(b.totalTdsDeductedMinor).toBe(TDS_PAISE);
  });

  it("the same TDS figure is the same number on all three endpoints", async () => {
    queue24Q();
    const a = (await get("/v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1")).json();
    state.matched = false;
    queue24Q();
    const f = (await forceFile()).json();
    queue26Q();
    const c = (await get("/v1/payroll/statutory/form26q?fy=2026-27&quarter=Q1")).json();

    expect(new Set([a.totalTdsDeductedMinor, f.totalTdsDeductedMinor, c.totalTdsDeductedMinor])).toEqual(new Set([TDS_PAISE]));
  });
});

describe("GAP-PAYROLL-RETURNS-06: no *Minor field on the family is a string", () => {
  it.each([
    ["GET form24q", async () => { queue24Q(); return (await get("/v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1")).json(); }],
    ["POST form24q/force-file", async () => { state.matched = false; queue24Q(); return (await forceFile()).json(); }],
    ["GET form26q", async () => { queue26Q(); return (await get("/v1/payroll/statutory/form26q?fy=2026-27&quarter=Q1")).json(); }],
  ] as const)("%s: every amount is an integer number of paise", async (_name, call) => {
    const leaves = minorLeaves(await call());
    expect(leaves.length).toBeGreaterThan(3);
    for (const { path, value } of leaves) {
      expect(typeof value, path).toBe("number");
      expect(Number.isInteger(value), path).toBe(true);
    }
  });

  it("an embedded reconciliation shortfall keeps its sign as a number (-500000 paise, not '-500000')", async () => {
    state.matched = false;
    queue24Q();
    const b = (await forceFile()).json();
    expect(b.reconciliation.perPeriod[0].varianceMinor).toBe(-500000);
    expect(b.reconciliation.perPeriod[0].tdsDepositedMinor).toBe(3_000_000);
  });
});

describe("GAP-PAYROLL-RETURNS-06: whole rupees exist only inside the TRACES flat file", () => {
  it("24Q JSON carries no whole-rupee twin of any TDS amount (nothing a client could read as paise)", async () => {
    queue24Q();
    const b = (await get("/v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1")).json();
    for (const k of ["totalTdsDeducted", "totalTdsDeposited"]) expect(b, k).not.toHaveProperty(k);
    for (const k of ["tdsDeducted", "tdsDeposited"]) {
      expect(b.deductees[0], k).not.toHaveProperty(k);
      expect(b.challanSummary[0], k).not.toHaveProperty(k);
    }
  });

  it("the 24Q flat file is byte-for-byte what it was: whole rupees with 2 decimals", async () => {
    queue24Q();
    const r = await get("/v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1&format=file");
    expect(r.statusCode, r.body).toBe(200);
    const lines = r.body.split("\r\n");
    expect(lines.filter((l) => l.startsWith("CD|"))).toEqual([
      "CD|1|2026-04|35000.00",
      "CD|2|2026-05|0.00",
      "CD|3|2026-06|0.00",
    ]);
    expect(lines.filter((l) => l.startsWith("DD|"))).toEqual(["DD|1|ABCDE1234F|Asha Verma|35000.00|35000.00"]);
    expect(lines.at(-1)).toMatch(/^FT\|\d+\|35000\.00$/);
  });

  it("the flat file rounds each record to the nearest whole rupee, and the trailer is the sum of the rounded records", async () => {
    // 12345 paise = Rs 123.45 -> 123.00 ; 5050 paise = Rs 50.50 -> 51.00 ; trailer 174.00
    const runs = [{ id: "run-1", status: "approved" }];
    const tdsRows = [
      { employeeId: "e1", runId: "run-1", period: "2026-04", tdsMinor: 12345n },
      { employeeId: "e2", runId: "run-1", period: "2026-04", tdsMinor: 5050n },
    ];
    for (const rows of [runs, tdsRows, runs, tdsRows, [], []]) readQueue.push(rows);
    const { fetchPayrollInput } = await import("../src/shared/hrms-client.js");
    vi.mocked(fetchPayrollInput).mockResolvedValueOnce({
      employees: [{ id: "e1", pan: "ABCDE1234F", fullName: "Asha Verma" }, { id: "e2", pan: "FGHIJ5678K", fullName: "Bina Rao" }],
    } as never);
    const r = await get("/v1/payroll/statutory/form24q?fy=2026-27&quarter=Q1&format=file");
    expect(r.statusCode, r.body).toBe(200);
    const lines = r.body.split("\r\n");
    expect(lines.filter((l) => l.startsWith("DD|"))).toEqual([
      "DD|1|ABCDE1234F|Asha Verma|123.00|123.00",
      "DD|2|FGHIJ5678K|Bina Rao|51.00|51.00",
    ]);
    expect(lines.at(-1)).toMatch(/\|174\.00$/);
  });

  it("the 26Q flat file renders the numeric paise as rupees.paise", async () => {
    queue26Q();
    const r = await get("/v1/payroll/statutory/form26q?fy=2026-27&quarter=Q1&format=file");
    expect(r.statusCode, r.body).toBe(200);
    expect(r.body).toContain("|1000000.00|35000.00"); // DD record: amount paid | TDS
    expect(r.body.trim().split("\r\n").pop()).toMatch(/\|35000\.00$/); // FT total
  });
});
