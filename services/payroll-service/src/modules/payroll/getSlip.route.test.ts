import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";

/**
 * REGRESSION: GET /v1/payroll/slips/:id sent pf/gpf/nps/esi/tds *Minor and
 * netPayMinor as JSON STRINGS. getSlip() spread `...row`, which carries those
 * drizzle bigint-mode columns as raw JS bigints; registerOpsRoutes'
 * preSerialization hook (jsonSafe) stringifies bigints, so the route did not
 * 500 but the web tier's SalarySlipDetailSchema (z.number()) rejected every
 * real slip. This asserts they arrive as JSON numbers.
 *
 * Unlike getSlip.test.ts (mocked repo), this drives the REAL Fastify route
 * against a REAL migrated Postgres (RLS-enforced) with a slip that carries
 * non-zero statutory deductions. Only the cross-service HRMS HTTP calls are
 * stubbed, and the stub deliberately returns a FULL bank account number so
 * this test also proves only its last 4 digits leave payroll-service
 * (GAP-PAYROLL-SALARY-SLIPS-DETAIL-05).
 */
const { EMPLOYEE_ID, FULL_ACCOUNT } = vi.hoisted(() => ({
  EMPLOYEE_ID: "7c1d2e3f-0000-4000-8000-00000000a754",
  FULL_ACCOUNT: "123456789012",
}));

vi.mock("../../shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared/hrms-client.js")>();
  return {
    ...actual,
    fetchEmployeeSummaries: async () => new Map(),
    fetchPayrollInput: async () => ({ employees: [{ id: EMPLOYEE_ID, fullName: "Asha Verma", bankAccountNo: FULL_ACCOUNT }] }),
    fetchDefaultSlipTemplate: async () => null,
  };
});

import { buildApp } from "../../app.js";
import { db, sqlClient } from "../../shared/db.js";
import * as repo from "./repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

describe("GET /v1/payroll/slips/:id against real Postgres (REGRESSION: bigint columns sent as strings)", () => {
  const tenantId = randomUUID();
  const creatorId = randomUUID();
  const runId = randomUUID();
  const slipId = randomUUID();
  const computedSlipId = randomUUID();
  const computedRunId = randomUUID();

  beforeAll(async () => {
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await repo.insertRun(tx, {
          id: runId, tenantId, runNo: "TEST-SLIP-BIGINT-1", month: "2026-08",
          departmentId: null, structureId: randomUUID(), runType: "regular", ddoCode: null,
          totalGrossMinor: 10_000_000n, totalNetMinor: 8_000_000n, currency: "INR",
          status: "processing", createdBy: creatorId, updatedBy: creatorId,
        });
        await repo.insertSlip(tx, {
          id: slipId, tenantId, runId, employeeId: EMPLOYEE_ID, employeeNo: "EMP-BIGINT-1",
          basicMinor: 5_000_000n, grossMinor: 10_000_000n, totalDeductionsMinor: 2_000_000n,
          netPayMinor: 8_000_000n, currency: "INR",
          components: [{ code: "BASIC", name: "Basic", type: "earning", amountMinor: 5_000_000 }],
          pfEmployeeMinor: 600_000n, pfEmployerMinor: 600_000n, gpfMinor: 100_000n,
          npsEmployeeMinor: 200_000n, npsEmployerMinor: 280_000n, esiMinor: 75_000n, tdsMinor: 150_000n,
          status: "paid", createdBy: creatorId, updatedBy: creatorId,
        });
        // payroll_slips is unique per (tenant, run, employee): the computed
        // slip lives in its own (later, not yet disbursed) run.
        await repo.insertRun(tx, {
          id: computedRunId, tenantId, runNo: "TEST-SLIP-GATE-2", month: "2026-09",
          departmentId: null, structureId: randomUUID(), runType: "regular", ddoCode: null,
          totalGrossMinor: 10_000_000n, totalNetMinor: 8_000_000n, currency: "INR",
          status: "processing", createdBy: creatorId, updatedBy: creatorId,
        });
        await repo.insertSlip(tx, {
          id: computedSlipId, tenantId, runId: computedRunId, employeeId: EMPLOYEE_ID, employeeNo: "EMP-BIGINT-1",
          basicMinor: 5_000_000n, grossMinor: 10_000_000n, totalDeductionsMinor: 2_000_000n,
          netPayMinor: 8_000_000n, currency: "INR", components: [],
          status: "computed", createdBy: creatorId, updatedBy: creatorId,
        });
      }),
    );
  });

  afterAll(async () => { await sqlClient.end(); });

  it("returns 200 with every statutory column as a JSON number and only the bank-account last 4", async () => {
    const app = await buildApp();
    const token = signToken({ sub: creatorId, tid: tenantId, roles: ["payroll_admin"], sid: "sess-slip-bigint" }, SECRET);
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${slipId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body.id).toBe(slipId);
    expect(body.netPayMinor).toBe(8_000_000);
    expect(body.pfEmployeeMinor).toBe(600_000);
    expect(body.pfEmployerMinor).toBe(600_000);
    expect(body.gpfMinor).toBe(100_000);
    expect(body.npsEmployeeMinor).toBe(200_000);
    expect(body.npsEmployerMinor).toBe(280_000);
    expect(body.esiMinor).toBe(75_000);
    expect(body.tdsMinor).toBe(150_000);
    expect(body.payPeriod).toBe("2026-08");
    expect(body.bankAccountLast4).toBe("9012");
    expect(res.body).not.toContain(FULL_ACCOUNT);
  });

  // GAP-PAYROLL-SALARY-SLIPS-05 / SLIPS-DETAIL-05: the print gate is enforced
  // by the API, not only the UI.
  for (const route of ["pdf", "download"] as const) {
    it(`/${route}: 409 SLIP_NOT_FINAL for a computed slip, 200 for a paid slip`, async () => {
      const app = await buildApp();
      const token = signToken({ sub: creatorId, tid: tenantId, roles: ["payroll_admin"], sid: "sess-slip-gate" }, SECRET);
      const blocked = await app.inject({
        method: "GET", url: `/v1/payroll/slips/${computedSlipId}/${route}`,
        headers: { authorization: `Bearer ${token}` },
      });
      const allowed = await app.inject({
        method: "GET", url: `/v1/payroll/slips/${slipId}/${route}`,
        headers: { authorization: `Bearer ${token}` },
      });
      await app.close();
      expect(blocked.statusCode).toBe(409);
      expect(blocked.body).toContain("SLIP_NOT_FINAL");
      expect(allowed.statusCode).toBe(200);
      expect(allowed.body).not.toContain(FULL_ACCOUNT);
      if (route === "pdf") expect(allowed.body).toContain("•••• 9012");
    });
  }
});
