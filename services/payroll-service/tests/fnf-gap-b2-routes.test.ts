/**
 * GAP-PAYROLL-FNF-03 / FNF-05 (b2-payroll-retirement batch) — F&F route hardening.
 *
 * - Money fields on POST /v1/payroll/fnf/compute used to be
 *   `z.string().transform(BigInt)`: a decimal ("1234.5") or junk string made
 *   BigInt() throw inside the transform -> an unhandled 500; a negative
 *   ("-5") was accepted. Now a whole non-negative paise string -> 400 otherwise.
 * - `overrides` (record-derived inputs the clerk changed + reason) is
 *   validated (reason >= 10 chars) and forwarded on the compute command.
 * - GET list/detail enrich each settlement with employeeName/employeeCode via
 *   hrms-client (best-effort), so the web card never shows a raw UUID.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000b2";
const USER = "aaaaaaaa-bbbb-4000-8000-0000000000b2";

const H = vi.hoisted(() => ({
  scopedRead: vi.fn(),
  publish: vi.fn(),
  fetchEmployeeSummaries: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) },
  scopedRead: (...a: unknown[]) => H.scopedRead(...a),
  sqlClient: { end: vi.fn() },
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn(async (_k: string, fn: () => unknown) => fn()),
    makeKey: vi.fn((...a: string[]) => a.join(":")),
    invalidate: vi.fn(),
  },
  queue: { publish: (...a: unknown[]) => H.publish(...a), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(), markProcessed: vi.fn(() => true), outboxMessages: {}, processed: {}, outboxSchema: {},
}));
vi.mock("../src/modules/tax/config.js", () => ({ loadTaxConfig: vi.fn() }));
vi.mock("../src/shared/hrms-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/hrms-client.js")>()),
  fetchEmployeeSummaries: (...a: unknown[]) => H.fetchEmployeeSummaries(...a),
  // HRMS confirms the payload's service length / leave balance (the compute route fails closed otherwise).
  fetchFnfServiceSnapshot: async () => ({ kind: "ok" as const, completedYears: 20, leaveBalanceDays: 120 }),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";

afterAll(async () => { await sqlClient.end(); });

const auth = () => ({ authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles: ["payroll_admin"], sid: "s1" }, SECRET)}` });

function payload(extra: Record<string, unknown> = {}) {
  return {
    employeeId: randomUUID(), separationDate: "2026-06-30", separationType: "retirement", employeeCategory: "govt",
    lastDrawnWagesMinor: "5000000", completedYears: 20, avgSalaryLast10MonthsMinor: "5000000", leaveBalanceDays: 120,
    taxRegime: "new", salaryYtdMinor: "0", tdsYtdMinor: "0", fyStartYear: 2026,
    ...extra,
  };
}

async function compute(body: Record<string, unknown>) {
  const app = await buildApp();
  const res = await app.inject({ method: "POST", url: "/v1/payroll/fnf/compute", headers: auth(), payload: body });
  await app.close();
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  H.scopedRead.mockResolvedValue([]);
  H.publish.mockResolvedValue(undefined);
  H.fetchEmployeeSummaries.mockResolvedValue(new Map());
});

describe("POST /v1/payroll/fnf/compute — money fields are whole non-negative paise (GAP-PAYROLL-FNF-03)", () => {
  it.each([
    ["decimal rupees string", "1234.5"],
    ["non-numeric string", "abc"],
    ["negative amount", "-500"],
    ["exponent notation", "1e5"],
  ])("rejects %s with 400 VALIDATION_FAILED (was a 500 / silently accepted)", async (_label, bad) => {
    const res = await compute(payload({ gratuityGrossMinor: bad }));
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect(H.publish).not.toHaveBeenCalled();
  });

  it("accepts whole paise strings, including zero", async () => {
    const res = await compute(payload({ gratuityGrossMinor: "123456", tdsYtdMinor: "0" }));
    expect(res.statusCode).toBe(202);
  });
});

describe("POST /v1/payroll/fnf/compute — override reason (GAP-PAYROLL-FNF-03)", () => {
  it("forwards overrides (fields + reason) on the compute command", async () => {
    const res = await compute(payload({ overrides: { fields: ["completedYears"], reason: "Service book shows 2 extra years of deputation" } }));
    expect(res.statusCode).toBe(202);
    const [topic, msg] = H.publish.mock.calls[0]!;
    expect(topic).toBe(COMMANDS.fnfCompute);
    expect((msg as { payload: Record<string, unknown> }).payload.overrides).toEqual({
      fields: ["completedYears"], reason: "Service book shows 2 extra years of deputation",
    });
  });

  it("rejects an override with a reason shorter than 10 characters", async () => {
    const res = await compute(payload({ overrides: { fields: ["leaveBalanceDays"], reason: "typo" } }));
    expect(res.statusCode).toBe(400);
    expect(H.publish).not.toHaveBeenCalled();
  });

  it("rejects an override of a field that is not record-derived", async () => {
    const res = await compute(payload({ overrides: { fields: ["gratuityGrossMinor"], reason: "a perfectly long reason" } }));
    expect(res.statusCode).toBe(400);
  });

  it("omits overrides from the command when none were sent", async () => {
    await compute(payload());
    const [, msg] = H.publish.mock.calls[0]!;
    expect((msg as { payload: Record<string, unknown> }).payload).not.toHaveProperty("overrides");
  });
});

function settlementRow(employeeId: string) {
  return {
    id: randomUUID(), tenantId: TENANT, employeeId, runId: null,
    separationType: "retirement", separationDate: "2026-06-30", employeeCategory: "govt",
    noticeBuyoutMinor: 0n, leaveEncashmentGrossMinor: 100n, gratuityGrossMinor: 200n,
    retrenchmentCompMinor: 0n, vrsCompMinor: 0n, arrearsMinor: 0n,
    gratuityExemptMinor: 200n, leaveEncashExemptMinor: 100n, retrenchmentExemptMinor: 0n, vrsExemptMinor: 0n,
    totalTaxableMinor: 0n, tdsOnSeparationMinor: 0n, netPayableMinor: 300n,
    computationDetail: {}, status: "draft", currency: "INR",
    createdAt: new Date(), updatedAt: new Date(), createdBy: USER, updatedBy: USER, version: 1,
  };
}

describe("GET /v1/payroll/fnf/settlements — employee enrichment (GAP-PAYROLL-FNF-05)", () => {
  it("adds employeeName + employeeCode from hrms, null when unresolved", async () => {
    const known = randomUUID();
    const unknown = randomUUID();
    H.scopedRead.mockResolvedValue([settlementRow(known), settlementRow(unknown)]);
    H.fetchEmployeeSummaries.mockResolvedValue(new Map([[known, { fullName: "Meera Iyer", departmentName: "Finance", employeeNo: "EMP-0451" }]]));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/fnf/settlements", headers: auth() });
    await app.close();
    expect(res.statusCode).toBe(200);
    const [a, b] = res.json().data;
    expect(a).toMatchObject({ employeeName: "Meera Iyer", employeeCode: "EMP-0451", netPayableMinor: "300" });
    expect(b).toMatchObject({ employeeName: null, employeeCode: null });
  });

  it("enriches the single-settlement read too", async () => {
    const emp = randomUUID();
    const row = settlementRow(emp);
    H.scopedRead.mockResolvedValue([row]);
    H.fetchEmployeeSummaries.mockResolvedValue(new Map([[emp, { fullName: "Meera Iyer", departmentName: "Finance", employeeNo: "EMP-0451" }]]));
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/fnf/settlements/${row.id}`, headers: auth() });
    await app.close();
    expect(res.json().data).toMatchObject({ employeeName: "Meera Iyer", employeeCode: "EMP-0451" });
  });
});
