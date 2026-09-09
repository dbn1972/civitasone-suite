/**
 * PERF-005 regression tests — payroll-service tranche.
 *
 * Covers the 3 payroll sites named in docs/ENTERPRISE-GAP-REPORT-2026-09-07.md's
 * PERF-005 row:
 *   - payroll/queries.ts::listRuns (was Promise.all(listSlipsByRun) N+1-via-Promise.all)
 *   - statutory/ecr-routes.ts GET /v1/payroll/statutory/ecr (was one slip query per PF record)
 *   - tax/routes.ts GET /v1/payroll/tax/computation (was months x runs nested N+1)
 *
 * Query counting uses the real driver-level counter from @civitasone/db
 * (countQueriesDuring — wraps postgres-js's own `debug` hook). Like the
 * grant-service PERF-005 tests, the primary assertion is O(1)-not-O(N): the
 * same code path issues the SAME query count for a small dataset and a large
 * one — that is what distinguishes a batch loader from a per-row loop.
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, countQueriesDuring } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";
import { payrollPf } from "../src/modules/statutory/schema.js";
import { listRuns } from "../src/modules/payroll/queries.js";
import { buildApp } from "../src/app.js";

const ACTOR = "60000000-aaaa-4000-8000-000000000001";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn() };
});
import { fetchPayrollInput } from "../src/shared/hrms-client.js";

function token(roles = ["payroll_admin", "super_admin"], tenant: string) {
  return signToken({ sub: ACTOR, tid: tenant, roles, sid: "perf005" }, SECRET);
}

async function wipe(tenant: string) {
  await runWithTenant(tenant, () => db.transaction(async (tx) => {
    await tx.delete(payrollPf).where(eq(payrollPf.tenantId, tenant));
    await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, tenant));
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, tenant));
  }));
}

afterAll(async () => { await sqlClient.end(); });

describe("PERF-005 — payroll-service N+1 fixes", () => {
  it("listRuns: query count is O(1) not O(N) in run count, employeeCount matches slip count (was Promise.all N+1)", async () => {
    async function seedRunsWithSlips(tenant: string, n: number) {
      // Distinct months: (tenant, month, ddo, run_type=regular) is uniquely
      // constrained, so n runs for one tenant need n distinct (year, month)
      // pairs — roll over into the next year past 12.
      const runs = Array.from({ length: n }, (_, i) => ({
        id: randomUUID(), tenantId: tenant, runNo: `RUN-${i}`,
        month: `${2026 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`,
        structureId: randomUUID(), totalGrossMinor: 500000n, totalNetMinor: 450000n,
        currency: "INR", status: "approved", createdBy: ACTOR, updatedBy: ACTOR,
      }));
      // 3 slips per run, so total row count scales with n too.
      const slips = runs.flatMap((run) => Array.from({ length: 3 }, (_, j) => ({
        id: randomUUID(), tenantId: tenant, runId: run.id,
        employeeId: randomUUID(), employeeNo: `EMP-${run.runNo}-${j}`,
        basicMinor: 100000n, grossMinor: 166000n, totalDeductionsMinor: 16000n,
        netPayMinor: 150000n, currency: "INR", components: [],
        createdBy: ACTOR, updatedBy: ACTOR,
      })));
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        await tx.insert(payrollRuns).values(runs);
        await tx.insert(payrollSlips).values(slips);
      }));
      return { runs, slips };
    }

    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    await seedRunsWithSlips(tenantSmall, 2);
    const large = await seedRunsWithSlips(tenantLarge, 20);
    try {
      const { queryCount: countSmall } = await countQueriesDuring(() =>
        runWithTenant(tenantSmall, () => listRuns(tenantSmall, 100)));
      const { result: runsResult, queryCount: countLarge } = await countQueriesDuring(() =>
        runWithTenant(tenantLarge, () => listRuns(tenantLarge, 100)));

      // O(1): same round-trip count for 2 runs (6 slips) as for 20 runs (60
      // slips). The old Promise.all(listSlipsByRun) code made one additional
      // query per run, so it would scale with run count.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(12);

      expect(runsResult).toHaveLength(20);
      for (const run of runsResult) {
        const expectedCount = large.slips.filter((s) => s.runId === run.id).length;
        expect(run.employeeCount).toBe(expectedCount);
        expect(run.employeeCount).toBe(3);
      }
    } finally {
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });

  it("GET /v1/payroll/statutory/ecr: query count is O(1) not O(N) in PF-record count (was one slip query per record)", async () => {
    async function seedPfAndSlips(tenant: string, n: number) {
      const run = { id: randomUUID(), tenantId: tenant, runNo: "ECR-RUN", month: "2026-05",
        structureId: randomUUID(), totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR",
        status: "approved", createdBy: ACTOR, updatedBy: ACTOR };
      const employees = Array.from({ length: n }, (_, i) => ({
        id: randomUUID(), employeeNo: `ECR-EMP-${i}`, fullName: `ECR Employee ${i}`,
        basicMinor: "100000", dateOfJoining: "2020-01-01", payStructureId: null,
        bankAccountNo: null, bankIfsc: null, pan: null, uan: `UAN${1000 + i}`,
        cityClass: "X" as const, taxRegime: "new" as const, departmentId: randomUUID(),
        pensionScheme: "EPF" as const,
      }));
      const slips = employees.map((e) => ({
        id: randomUUID(), tenantId: tenant, runId: run.id, employeeId: e.id,
        employeeNo: e.employeeNo, basicMinor: 100000n, grossMinor: 150000n,
        totalDeductionsMinor: 12000n, netPayMinor: 138000n, currency: "INR",
        components: [], createdBy: ACTOR, updatedBy: ACTOR,
      }));
      const pfRecords = slips.map((slip, i) => ({
        id: randomUUID(), tenantId: tenant, slipId: slip.id, employeeId: employees[i]!.id,
        runId: run.id, basicMinor: 100000n, empContribMinor: 12000n, erContribMinor: 12000n,
        epsContribMinor: 5000n, epfErContribMinor: 7000n, period: "2026-05",
        createdBy: ACTOR, updatedBy: ACTOR,
      }));
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        await tx.insert(payrollRuns).values(run);
        await tx.insert(payrollSlips).values(slips);
        await tx.insert(payrollPf).values(pfRecords);
      }));
      return { employees, slips, pfRecords };
    }

    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    const small = await seedPfAndSlips(tenantSmall, 2);
    const large = await seedPfAndSlips(tenantLarge, 20);

    (fetchPayrollInput as ReturnType<typeof vi.fn>).mockImplementation(
      async (_tenant: string, month: string) => ({
        month,
        employees: [...small.employees, ...large.employees],
        lopDays: {},
      }));

    const app = await buildApp();
    try {
      const tokSmall = token(["payroll_admin"], tenantSmall);
      const tokLarge = token(["payroll_admin"], tenantLarge);

      const { queryCount: countSmall } = await countQueriesDuring(() =>
        app.inject({ method: "GET", url: "/v1/payroll/statutory/ecr?month=2026-05", headers: { authorization: `Bearer ${tokSmall}` } }));
      const { result: res, queryCount: countLarge } = await countQueriesDuring(() =>
        app.inject({ method: "GET", url: "/v1/payroll/statutory/ecr?month=2026-05", headers: { authorization: `Bearer ${tokLarge}` } }));

      expect(res.statusCode).toBe(200);
      // O(1): same round-trip count for 2 PF records as for 20. The old
      // per-record slip-fetch loop would scale with PF-record count.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(8);

      // Response-shape parity: one ECR line per PF record, gross wages
      // resolved from the matching slip (not defaulted to 0, which is what
      // a broken slip lookup would silently produce).
      const lines = (res.body as string).trim().split(/\r\n/);
      expect(lines).toHaveLength(20);
      for (const line of lines) {
        const cols = line.split("|");
        expect(cols[2]).not.toBe("0"); // Gross Wages
      }
    } finally {
      await app.close();
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });

  it("GET /v1/payroll/tax/computation: query count is O(1) not O(N) in matching-run count (was months x runs nested N+1)", async () => {
    const employeeId = randomUUID();

    async function seedFyRuns(tenant: string, monthsWithRuns: string[]) {
      const runs = monthsWithRuns.map((month) => ({
        id: randomUUID(), tenantId: tenant, runNo: `TAX-${month}`, month,
        structureId: randomUUID(), totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR",
        status: "approved", createdBy: ACTOR, updatedBy: ACTOR,
      }));
      const slips = runs.map((run) => ({
        id: randomUUID(), tenantId: tenant, runId: run.id, employeeId,
        employeeNo: "TAX-EMP", basicMinor: 50000n, grossMinor: 100000n,
        totalDeductionsMinor: 10000n, netPayMinor: 90000n, currency: "INR",
        components: [], pfEmployeeMinor: 6000n, createdBy: ACTOR, updatedBy: ACTOR,
      }));
      await runWithTenant(tenant, () => db.transaction(async (tx) => {
        await tx.insert(payrollRuns).values(runs);
        await tx.insert(payrollSlips).values(slips);
      }));
      return { runs, slips };
    }

    const tenantSmall = randomUUID();
    const tenantLarge = randomUUID();
    // FY 2025-26 = Apr'25..Mar'26. "Small" has runs in 2 of the 12 months,
    // "large" has a run in every one of the 12 months — the old code's cost
    // scaled with matching-run count across the FY, this scales that axis.
    await seedFyRuns(tenantSmall, ["2025-04", "2025-05"]);
    const large = await seedFyRuns(tenantLarge, [
      "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09",
      "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
    ]);

    const app = await buildApp();
    try {
      const tokSmall = token(["payroll_admin"], tenantSmall);
      const tokLarge = token(["payroll_admin"], tenantLarge);
      const url = `/v1/payroll/tax/computation?employeeId=${employeeId}&fy=2025-26&regime=new`;

      const { queryCount: countSmall } = await countQueriesDuring(() =>
        app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tokSmall}` } }));
      const { result: res, queryCount: countLarge } = await countQueriesDuring(() =>
        app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tokLarge}` } }));

      expect(res.statusCode).toBe(200);
      // O(1): same round-trip count whether 2 of the 12 FY months have a
      // matching run or all 12 do. The old nested loop issued one runs query
      // per FY month (always 12) PLUS one slips query per matching run, so
      // it would scale from 2+2=... up through 12+12 queries just on this axis.
      expect(countLarge).toBe(countSmall);
      expect(countLarge).toBeLessThanOrEqual(12);

      const body = res.json();
      // annualGross should reflect ALL 12 matching runs for the large tenant
      // (12 slips x grossMinor 100000 = 1,200,000 minor = Rs 12,000), proving
      // the batched rewrite didn't drop any months' slips.
      const expectedGross = Math.round(large.slips.length * 100000 / 100);
      expect(body.annualGross).toBe(expectedGross);
    } finally {
      await app.close();
      await wipe(tenantSmall);
      await wipe(tenantLarge);
    }
  });
});
