/**
 * PAY-PROFILES (PR2): the stored Sec 10(13A) HRA exemption (tax declaration
 * hraClaimed -> Form 16 Part B) uses the same pay-profile inputs and HRA
 * floor as the payslip. Real Postgres + real tax consumer; only the HRMS
 * boundary is mocked (same harness as hra-exemption-declaration.test.ts).
 *
 * Golden G8: old regime, basic 15,000/mo, DA 0, X, rent 1,20,000/yr, floor
 * 5,400 in force -> HRA received 64,800 -> exemption 64,800 (43,200 before).
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { sql, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";

const H = vi.hoisted(() => ({ employee: {} as Record<string, unknown> }));
vi.mock("../src/shared/hrms-client.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  resolveActorEmployeeId: vi.fn(async () => "70000000-4802-4000-8000-0000000000e1"),
  fetchPayrollInput: vi.fn(async () => ({ month: "2026-03", employees: [H.employee], lopDays: {}, overtimeHours: {} })),
}));

import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerTaxConsumers } from "../src/modules/tax/consumer.js";
import { taxDeclarations } from "../src/modules/tax/schema.js";
import type { MemoryQueue } from "@civitasone/queue";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "90000000-4802-4000-8000-000000000001";
const EMPLOYEE = "70000000-4802-4000-8000-0000000000e1";
const LOGIN = "70000000-4802-4000-8000-0000000000f1";
const FY = "2025-26";

const baseEmployee = {
  id: EMPLOYEE, employeeNo: "HRA2-EMP", fullName: "HRA Floor Employee", basicMinor: "1500000", dateOfJoining: "2020-01-01",
  payStructureId: null, bankAccountNo: null, bankIfsc: null, pan: null, uan: null, pran: null,
  cityClass: "X", taxRegime: "old", departmentId: "dept-1", pensionScheme: "EPF",
};

const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  const rawSubscribe = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    rawSubscribe(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerTaxConsumers(queue);
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${TENANT}::uuid, '2024-01-01', 0)`);
    await tx.execute(sql`INSERT INTO statutory.allowance_rule_config (tenant_id, effective_from, hra_floor_x_minor, hra_floor_y_minor, hra_floor_z_minor, change_reason, created_by)
      VALUES (${TENANT}::uuid, '2025-04-01', 540000, 360000, 180000, 'test floor', ${EMPLOYEE}::uuid)`);
  });
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.delete(taxDeclarations).where(eq(taxDeclarations.tenantId, TENANT));
    await tx.execute(sql`DELETE FROM payroll.dearness_allowance_rates WHERE tenant_id = ${TENANT}::uuid`);
    await tx.execute(sql`DELETE FROM statutory.allowance_rule_config WHERE tenant_id = ${TENANT}::uuid`);
  });
  await app.close();
  await sqlClient.end();
});

async function declare(employee: Record<string, unknown>): Promise<bigint> {
  H.employee = employee;
  await asTenant((tx) => tx.delete(taxDeclarations).where(eq(taxDeclarations.tenantId, TENANT)));
  const r = await app.inject({
    method: "POST", url: "/v1/payroll/tax-declarations",
    headers: { authorization: `Bearer ${signToken({ sub: LOGIN, tid: TENANT, roles: ["employee"], sid: "hra2" }, SECRET)}` },
    payload: { fy: FY, regime: "old", section80c: 0, section80d: 0, otherDeductions: 0, rentPaidMinor: 12_000_000, landlordPan: "ABCDE1234F" },
  });
  expect(r.statusCode).toBe(202);
  await (queue as unknown as MemoryQueue).drain();
  const rows = await asTenant((tx) => tx.select().from(taxDeclarations).where(eq(taxDeclarations.tenantId, TENANT)));
  return rows[0]!.hraClaimed;
}

describe("Sec 10(13A) exemption follows the pay profile and the HRA floor", () => {
  it("G8 govt_scale: floored HRA 5,400 -> exemption 64,800 (pre-floor 43,200)", async () => {
    expect(await declare(baseEmployee)).toBe(6_480_000n);
  });
  it("consolidated pay has no HRA -> no exemption even with rent declared", async () => {
    expect(await declare({ ...baseEmployee, payProfile: {
      profile: "consolidated_contract", source: "assigned", profileId: "2bcd7534-e350-43a0-8e48-ca8b2de3f50f",
      effectiveFrom: "2025-04-01", changedWithinMonth: false, consolidatedMonthlyMinor: "3000000",
    } })).toBe(0n);
  });
  it("Option A deputationist: exemption on the PARENT basic (45,000 -> HRA 24% = 10,800/mo)", async () => {
    const claimed = await declare({ ...baseEmployee, payProfile: {
      profile: "deputation_parent_scale", source: "assigned", profileId: "2bcd7534-e350-43a0-8e48-ca8b2de3f50f",
      effectiveFrom: "2025-04-01", changedWithinMonth: false,
      deputation: {
        id: "3bcd7534-e350-43a0-8e48-ca8b2de3f50f", status: "active", direction: "in", option: "parent_scale", stationType: "other",
        parentCadre: "CSS", parentOrganisation: "Ministry X", parentPayLevel: 7, parentBasicMinor: "4500000",
        postPayLevel: null, postBasicMinor: null, allowanceMode: "auto", fixedAllowanceMinor: "0", foreignService: false,
        parentPensionScheme: "NPS", daSource: "central", parentDaRateBps: null, tenureFrom: "2025-01-01", tenureTo: "2028-12-31",
      },
    } });
    // least of: HRA 1,29,600 | rent - 10% salary = 1,20,000 - 54,000 = 66,000 | 50% salary 2,70,000
    expect(claimed).toBe(6_600_000n);
  });
  it("ctc_contract: no throw, exemption 0 (its HRA comes from the CTC structure, PR3)", async () => {
    expect(await declare({ ...baseEmployee, payProfile: {
      profile: "ctc_contract", source: "assigned", profileId: "2bcd7534-e350-43a0-8e48-ca8b2de3f50f",
      effectiveFrom: "2025-04-01", changedWithinMonth: false,
    } })).toBe(0n);
  });
  it("lapsed deputation (repatriated before the snapshot month): no throw, government-scale fallback on the HRMS basic", async () => {
    expect(await declare({ ...baseEmployee, payProfile: {
      profile: "deputation_parent_scale", source: "assigned", profileId: "2bcd7534-e350-43a0-8e48-ca8b2de3f50f",
      effectiveFrom: "2025-04-01", changedWithinMonth: false,
      deputation: {
        id: "3bcd7534-e350-43a0-8e48-ca8b2de3f50f", status: "repatriated", direction: "out", option: "parent_scale", stationType: "other",
        parentCadre: "CSS", parentOrganisation: null, parentPayLevel: 7, parentBasicMinor: "4500000",
        postPayLevel: null, postBasicMinor: null, allowanceMode: "auto", fixedAllowanceMinor: "0", foreignService: false,
        parentPensionScheme: null, daSource: "central", parentDaRateBps: null, tenureFrom: "2025-01-01", tenureTo: "2028-12-31",
        repatriatedOn: "2025-12-31",
      },
    } })).toBe(6_480_000n); // same as G8: basic 15,000 floored HRA, not the 45,000 parent basic
  });
});
