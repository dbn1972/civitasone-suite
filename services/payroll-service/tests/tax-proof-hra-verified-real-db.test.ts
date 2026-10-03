/**
 * GAP-PAYROLL-TAX-DECLARATION-02 (review): after the proof cutoff the HRA
 * exemption is RECOMPUTED from the verified rent with the payroll engine's own
 * least-of-three, so tax/computation (and Form 16) match what the payroll run
 * deducts -- not a subtraction heuristic.
 *
 * Fixture (same as hra-exemption-declaration): basic 30,000/mo, metro, DA 50%
 * -> salary 5,40,000/yr, HRA received 1,08,000/yr, metro limit 50% = 2,70,000.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerTaxConsumers } from "../src/modules/tax/consumer.js";
import { payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";
import { taxDeclarations } from "../src/modules/tax/schema.js";
import { hraExemptionMinor } from "../src/modules/tax/engine.js";
import { applyPlanToRowExact } from "../src/modules/tax/verified-inputs.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "90000000-4802-4000-8000-000000000001";
const EMPLOYEE = "70000000-4802-4000-8000-0000000000e1";
const EMPLOYEE_LOGIN = "70000000-4802-4000-8000-0000000000f1";
const OFFICER = randomUUID();
const FY = "2025-26";

vi.mock("../src/shared/hrms-client.js", () => ({
  resolveActorEmployeeId: vi.fn(async (_t: string, actorId: string) =>
    actorId === "70000000-4802-4000-8000-0000000000f1" ? "70000000-4802-4000-8000-0000000000e1" : null),
  fetchPayrollInput: vi.fn(async () => ({
    month: "2026-03",
    employees: [{
      id: "70000000-4802-4000-8000-0000000000e1", employeeNo: "HRA2-EMP", fullName: "HRA Verified Employee",
      basicMinor: "3000000", dateOfJoining: "2020-01-01", payStructureId: null,
      bankAccountNo: null, bankIfsc: null, pan: null, uan: null, pran: null,
      cityClass: "X", taxRegime: "old", departmentId: "dept-1", pensionScheme: "EPF",
    }],
    lopDays: {}, overtimeHours: {},
  })),
  fetchEmployeeSummaries: vi.fn(async () => new Map()),
  HrmsUnavailableError: class HrmsUnavailableError extends Error { readonly code = "HRMS_UNAVAILABLE"; },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = queue as any;
const token = (sub: string) => signToken({ sub, tid: TENANT, roles: ["employee"], sid: "hra2" }, SECRET);
let app: Awaited<ReturnType<typeof buildApp>>;

async function exec(query: ReturnType<typeof sql>) {
  return runWithTenant(TENANT, () => db.transaction(async (tx) => { await tx.execute(query); }));
}
async function acceptedRentProof(amount: number) {
  await exec(sql`
    INSERT INTO payroll.tax_proofs (id, tenant_id, employee_id, fy, line, storage_key, filename, content_type, size_bytes, amount_minor, status, uploaded_by)
    VALUES (${randomUUID()}::uuid, ${TENANT}::uuid, ${EMPLOYEE}::uuid, ${FY}, 'rent', ${`payroll/${TENANT}/tax-proofs/${FY}/${EMPLOYEE}/${randomUUID()}.pdf`}, 'rent.pdf', 'application/pdf', 100, ${amount}, 'accepted', ${OFFICER}::uuid)`);
}
async function exemptionsAt(date: string): Promise<number> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(date));
  try {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/computation?fy=${FY}&regime=old`, headers: { authorization: `Bearer ${token(EMPLOYEE_LOGIN)}` } });
    expect(res.statusCode).toBe(200);
    return (res.json() as { exemptions: number }).exemptions;
  } finally { vi.useRealTimers(); }
}

beforeAll(async () => {
  const raw = q.subscribe.bind(q);
  q.subscribe = (topic: string, handler: (msg: { tenantId: string }) => Promise<void>) => raw(topic, (m: { tenantId: string }) => runWithTenant(m.tenantId, () => handler(m)));
  registerTaxConsumers(queue);
  app = await buildApp();
  await exec(sql`DELETE FROM payroll.tax_proofs WHERE tenant_id = ${TENANT}::uuid`);
  await exec(sql`DELETE FROM payroll.dearness_allowance_rates WHERE tenant_id = ${TENANT}::uuid`);
  await exec(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${TENANT}::uuid, '2024-01-01'::date, 5000)`);
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(taxDeclarations).where(eq(taxDeclarations.tenantId, TENANT));
    await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT));
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
    const runId = randomUUID();
    await tx.insert(payrollRuns).values({ id: runId, tenantId: TENANT, runNo: "HRA2-RUN", month: "2025-06", structureId: randomUUID(), totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "approved", createdBy: EMPLOYEE, updatedBy: EMPLOYEE });
    await tx.insert(payrollSlips).values({ id: randomUUID(), tenantId: TENANT, runId, employeeId: EMPLOYEE, employeeNo: "HRA2-EMP", basicMinor: 3000000n, grossMinor: 60_000_000n, totalDeductionsMinor: 0n, netPayMinor: 60_000_000n, currency: "INR", components: [], createdBy: EMPLOYEE, updatedBy: EMPLOYEE });
  }));
  // Declared rent 3,00,000 (the consumer computes hra_claimed = 1,08,000), tenant opted in from FY 2025-26.
  const submit = await app.inject({ method: "POST", url: "/v1/payroll/tax-declarations", headers: { authorization: `Bearer ${token(EMPLOYEE_LOGIN)}` },
    payload: { fy: FY, regime: "old", section80c: 0, section80d: 0, otherDeductions: 0, rentPaidMinor: 30_000_000, landlordPan: "ABCDE1234F" } });
  expect(submit.statusCode).toBe(202);
  await q.drain();
  await exec(sql`INSERT INTO payroll.payroll_settings (tenant_id, tax_proof_verified_from_fy) VALUES (${TENANT}::uuid, ${FY})
                 ON CONFLICT (tenant_id) DO UPDATE SET tax_proof_verified_from_fy = EXCLUDED.tax_proof_verified_from_fy, tax_proof_cutoff_md = '01-31'`);
});

afterAll(async () => {
  await app?.close();
  await exec(sql`DELETE FROM payroll.tax_proofs WHERE tenant_id = ${TENANT}::uuid`);
  await exec(sql`DELETE FROM payroll.payroll_settings WHERE tenant_id = ${TENANT}::uuid`);
  await exec(sql`DELETE FROM payroll.dearness_allowance_rates WHERE tenant_id = ${TENANT}::uuid`);
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(taxDeclarations).where(eq(taxDeclarations.tenantId, TENANT));
    await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT));
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
  }));
  await sqlClient.end();
});

describe("HRA exemption after verification is the engine's exact least-of-three", () => {
  it("the reviewer's worked example: basic 4L, HRA received 1L, declared rent 3L, verified rent 2.5L -> exemption 1.0L (not 0.5L)", async () => {
    const BASIC = 40_000_000n, HRA = 10_000_000n;
    expect(hraExemptionMinor(BASIC, HRA, 30_000_000n, true)).toBe(10_000_000n); // declared
    expect(hraExemptionMinor(BASIC, HRA, 25_000_000n, true)).toBe(10_000_000n); // verified
    // and through the row adapter: the recompute callback is used, not the subtraction bound
    const row = { employeeId: "e", regime: "old", section80c: 0n, section80d: 0n, otherDeductions: 0n, rentPaidMinor: 30_000_000n, hraClaimed: 10_000_000n };
    const out = await applyPlanToRowExact(
      { apply: true, verified: new Map([["e", { sec80c: 0n, sec80d: 0n, other: 0n, rent: 25_000_000n }]]) },
      row, async (_e, rent) => hraExemptionMinor(BASIC, HRA, rent, true),
    );
    expect(out.hraClaimed).toBe(10_000_000n);
    expect(out.rentPaidMinor).toBe(25_000_000n);
    // when the recomputation is unavailable it falls back to the conservative bound
    const fallback = await applyPlanToRowExact(
      { apply: true, verified: new Map([["e", { sec80c: 0n, sec80d: 0n, other: 0n, rent: 25_000_000n }]]) },
      row, async () => { throw new Error("hrms down"); },
    );
    expect(fallback.hraClaimed).toBe(5_000_000n);
  });

  it("tax/computation before the cutoff: declared rent -> HRA 1,08,000 (+ standard deduction 50,000)", async () => {
    expect(await exemptionsAt("2026-01-15T05:00:00Z")).toBe(158_000);
  });

  it("after the cutoff with verified rent 2,50,000 of 3,00,000: HRA stays 1,08,000 (HRA received binds), matching the payroll engine", async () => {
    await acceptedRentProof(25_000_000);
    expect(await exemptionsAt("2026-02-10T05:00:00Z")).toBe(158_000); // heuristic would have given 58,000
  });

  it("verified rent 1,50,000: exemption = min(1,08,000, 1,50,000 - 54,000 = 96,000, 2,70,000) = 96,000", async () => {
    await exec(sql`DELETE FROM payroll.tax_proofs WHERE tenant_id = ${TENANT}::uuid`);
    await acceptedRentProof(15_000_000);
    expect(await exemptionsAt("2026-02-10T05:00:00Z")).toBe(146_000); // 96,000 + 50,000 standard deduction
  });

  it("no accepted rent proof after the cutoff: no HRA exemption", async () => {
    await exec(sql`DELETE FROM payroll.tax_proofs WHERE tenant_id = ${TENANT}::uuid`);
    expect(await exemptionsAt("2026-02-10T05:00:00Z")).toBe(50_000);
  });
});
