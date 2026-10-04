/**
 * GAP-PAYROLL-STATUTORY-GPF-02 / NPS-02: the payroll GPF / NPS ledgers carry a
 * read-only reconciliation against the hrms-service per-employee accounts.
 * Pure verdict logic first, then the report routes end to end (repo +
 * hrms clients mocked).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { reconcileGpf, reconcileNps } from "../src/modules/statutory/reconcile.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000c9";
const USER_ID = "aaaaaaaa-bbbb-4000-8000-0000000000c9";

const H = vi.hoisted(() => ({
  listGpfMock: vi.fn(),
  listNpsMock: vi.fn(),
  fetchEmployeeSummariesMock: vi.fn(),
  fetchNpsPranLast4Mock: vi.fn(),
  fetchRetirementAccountsMock: vi.fn(),
}));

vi.mock("../src/modules/statutory/repo.js", () => ({
  listGpfByTenant: (...a: unknown[]) => H.listGpfMock(...a),
  listNpsByTenant: (...a: unknown[]) => H.listNpsMock(...a),
  listPfByTenant: vi.fn(async () => []),
  listEsiByTenant: vi.fn(async () => []),
  listTdsByTenant: vi.fn(async () => []),
  listGratuityByTenant: vi.fn(async () => []),
  insertPf: vi.fn(), insertEsi: vi.fn(), insertTds: vi.fn(), insertGratuity: vi.fn(), insertGpf: vi.fn(), insertNps: vi.fn(),
  sumEmployerContribByRun: vi.fn(() => 0n),
}));
vi.mock("../src/shared/hrms-client.js", () => ({
  fetchEmployeeSummaries: (...a: unknown[]) => H.fetchEmployeeSummariesMock(...a),
  fetchNpsPranLast4: (...a: unknown[]) => H.fetchNpsPranLast4Mock(...a),
}));
vi.mock("../src/shared/hrms-retirement-client.js", () => ({
  fetchRetirementAccounts: (...a: unknown[]) => H.fetchRetirementAccountsMock(...a),
}));
vi.mock("../src/modules/tax/config.js", () => ({ loadTaxConfig: vi.fn() }));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

afterAll(async () => { await sqlClient.end(); });
const token = () => signToken({ sub: USER_ID, tid: TENANT, roles: ["payroll_admin"], sid: "s1" }, SECRET);

describe("reconcileGpf", () => {
  const acct = (m: bigint, status = "active") => ({ monthlySubscriptionMinor: m, status });
  it("match when the hrms monthly subscription equals the payroll contribution", () => {
    expect(reconcileGpf(960000n, acct(960000n), "complete")).toEqual({ status: "match", hrmsMonthlySubscriptionMinor: "960000" });
  });
  it("mismatch when they differ", () => {
    expect(reconcileGpf(960000n, acct(500000n), "complete")).toEqual({ status: "mismatch", hrmsMonthlySubscriptionMinor: "500000" });
  });
  it("no_hrms_account when absent or not active", () => {
    expect(reconcileGpf(1n, undefined, "complete").status).toBe("no_hrms_account");
    expect(reconcileGpf(1n, acct(1n, "closed"), "complete").status).toBe("no_hrms_account");
  });
  it("keeps money as a string, exact above 2^53 (no Number coercion)", () => {
    const big = 9007199254740993n; // 2^53 + 1
    expect(reconcileGpf(big, acct(big), "complete")).toEqual({ status: "match", hrmsMonthlySubscriptionMinor: "9007199254740993" });
  });
  it("partial list: a present account still reconciles, an absent one is NOT 'no_hrms_account'", () => {
    expect(reconcileGpf(1n, acct(1n), "partial").status).toBe("match");
    expect(reconcileGpf(1n, undefined, "partial")).toEqual({ status: "hrms_unavailable", hrmsMonthlySubscriptionMinor: null });
  });
  it("hrms_unavailable (no verdict) when HRMS could not be reached", () => {
    expect(reconcileGpf(1n, undefined, "unavailable")).toEqual({ status: "hrms_unavailable", hrmsMonthlySubscriptionMinor: null });
  });
});

describe("reconcileNps", () => {
  const acct = (emp: number, er: number, status = "active") => ({ empContribPct: emp, erContribPct: er, status });
  it("match on equal percentages", () => {
    expect(reconcileNps(10, 14, acct(10, 14), "complete")).toEqual({ status: "match", hrmsEmpContribPct: 10, hrmsErContribPct: 14 });
  });
  it("mismatch when either percentage differs", () => {
    expect(reconcileNps(10, 14, acct(10, 10), "complete").status).toBe("mismatch");
    expect(reconcileNps(10, 14, acct(12, 14), "complete").status).toBe("mismatch");
  });
  it("partial list: an absent employee is hrms_unavailable, never no_hrms_account", () => {
    expect(reconcileNps(10, 14, undefined, "partial").status).toBe("hrms_unavailable");
    expect(reconcileNps(10, 14, acct(10, 14), "partial").status).toBe("match");
  });
  it("no_hrms_account / hrms_unavailable", () => {
    expect(reconcileNps(10, 14, undefined, "complete").status).toBe("no_hrms_account");
    expect(reconcileNps(10, 14, undefined, "unavailable").status).toBe("hrms_unavailable");
  });
});

describe("statutory GPF / NPS report routes carry the reconciliation verdict", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.fetchEmployeeSummariesMock.mockResolvedValue(new Map());
    H.fetchNpsPranLast4Mock.mockResolvedValue(new Map());
  });

  it("GPF rows: match / mismatch / no account", async () => {
    H.listGpfMock.mockResolvedValue([
      { id: "g1", employeeId: "e1", period: "2026-06", basicMinor: 9600000n, contribPct: "10", empContribMinor: 960000n },
      { id: "g2", employeeId: "e2", period: "2026-06", basicMinor: 9600000n, contribPct: "10", empContribMinor: 960000n },
      { id: "g3", employeeId: "e3", period: "2026-06", basicMinor: 9600000n, contribPct: "10", empContribMinor: 960000n },
    ]);
    H.fetchRetirementAccountsMock.mockResolvedValue({
      gpf: new Map([["e1", { monthlySubscriptionMinor: 960000n, status: "active" }], ["e2", { monthlySubscriptionMinor: 1n, status: "active" }]]),
      nps: new Map(), gpfTruncated: false, npsTruncated: false,
    });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/gpf", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().map((r: { reconciliation: { status: string } }) => r.reconciliation.status)).toEqual(["match", "mismatch", "no_hrms_account"]);
  });

  it("NPS rows: mismatch is flagged with the hrms percentages; unreachable HRMS gives no verdict", async () => {
    H.listNpsMock.mockResolvedValue([{
      id: "n1", employeeId: "e1", period: "2026-06", basicMinor: 7000000n,
      empContribPct: "10.00", erContribPct: "14.00", empContribMinor: 700000n, erContribMinor: 980000n,
    }]);
    H.fetchRetirementAccountsMock.mockResolvedValueOnce({
      gpf: new Map(), gpfTruncated: false, npsTruncated: false,
      nps: new Map([["e1", { empContribPct: 10, erContribPct: 10, status: "active" }]]),
    });
    let app = await buildApp();
    let res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/nps", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(res.json()[0].reconciliation).toEqual({ status: "mismatch", hrmsEmpContribPct: 10, hrmsErContribPct: 10 });

    H.fetchRetirementAccountsMock.mockResolvedValueOnce(null);
    app = await buildApp();
    res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/nps", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].reconciliation.status).toBe("hrms_unavailable");
  });

  it("GPF: when hrms cut its account list, an employee past the cut shows hrms_unavailable (not no_hrms_account)", async () => {
    H.listGpfMock.mockResolvedValue([
      { id: "g1", employeeId: "e1", period: "2026-06", basicMinor: 1n, contribPct: "10", empContribMinor: 5n },
      { id: "g2", employeeId: "e-past-cut", period: "2026-06", basicMinor: 1n, contribPct: "10", empContribMinor: 5n },
    ]);
    H.fetchRetirementAccountsMock.mockResolvedValue({
      gpf: new Map([["e1", { monthlySubscriptionMinor: 5n, status: "active" }]]), nps: new Map(), gpfTruncated: true, npsTruncated: false,
    });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/gpf", headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(res.json().map((r: { reconciliation: { status: string } }) => r.reconciliation.status)).toEqual(["match", "hrms_unavailable"]);
  });
});
