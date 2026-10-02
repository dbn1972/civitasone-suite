/**
 * PAY-PROFILES (PR1), payroll side:
 *
 *  1. fetchPayrollInput validates the new payroll-input fields at the boundary
 *     (payProfile / engagement / advisories): a well-formed feed -- with or
 *     without the new fields (HRMS version skew) -- passes through unchanged;
 *     a malformed money/enum value fails the fetch CLOSED with
 *     HrmsUnavailableError instead of flowing into pay.
 *  2. GET /v1/payroll/internal/locked-through returns the latest approved or
 *     disbursed salary-run month (pensioner runs and open runs excluded),
 *     which hrms-service uses to refuse back-dated pay-profile changes.
 */
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { fetchPayrollInput, HrmsUnavailableError } from "../src/shared/hrms-client.js";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function serve(body: unknown): void {
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(body) }) as unknown as typeof fetch;
}

const legacyEmployee = {
  id: "e1", employeeNo: "E-1", fullName: "A", basicMinor: "5000000", dateOfJoining: "2020-01-01",
  payStructureId: null, bankAccountNo: null, bankIfsc: null, pan: null, uan: null, cityClass: "X",
  taxRegime: "new", departmentId: "d1", pensionScheme: "NPS", paymentRoute: "payroll", eligibleForPayroll: true,
};

const deputationBlock = {
  id: "2bcd7534-e350-43a0-8e48-ca8b2de3f50f", status: "active", direction: "in", option: "parent_scale",
  stationType: "other", parentCadre: "CSS", parentOrganisation: "Ministry X", parentPayLevel: 7,
  parentBasicMinor: "4490000", postPayLevel: null, postBasicMinor: null, allowanceMode: "auto",
  fixedAllowanceMinor: "0", foreignService: false, parentPensionScheme: "NPS", daSource: "central",
  parentDaRateBps: null, tenureFrom: "2026-10-15", tenureTo: "2029-10-14",
};

const withProfile = (payProfile: Record<string, unknown>) => ({
  month: "2026-11",
  employees: [{
    ...legacyEmployee,
    payProfile,
    engagement: { category: "legacy", payMode: "monthly", taxSection: "192", eligibleForGratuity: true, eligibleForBonus: false },
    advisories: [],
  }],
  lopDays: {}, overtimeHours: {},
});

describe("fetchPayrollInput -- PAY-PROFILES boundary validation", () => {
  it("an HRMS that predates PAY-PROFILES (no new fields) passes through unchanged", async () => {
    const body = { month: "2026-11", employees: [legacyEmployee], lopDays: { e1: 2 }, overtimeHours: {} };
    serve(body);
    await expect(fetchPayrollInput("t1", "2026-11")).resolves.toEqual(body);
  });

  it("a well-formed deputation profile passes through unchanged", async () => {
    const body = withProfile({
      profile: "deputation_parent_scale", source: "assigned", profileId: "2bcd7534-e350-43a0-8e48-ca8b2de3f50f",
      effectiveFrom: "2026-11-01", changedWithinMonth: false, deputation: deputationBlock,
    });
    serve(body);
    const out = await fetchPayrollInput("t1", "2026-11");
    expect(out).toEqual(body);
    expect(out.employees[0]!.payProfile?.deputation?.parentBasicMinor).toBe("4490000");
  });

  it.each([
    ["unknown profile", { profile: "bogus", source: "default", profileId: null, effectiveFrom: null, changedWithinMonth: false }],
    ["non-digit consolidated amount", { profile: "consolidated_contract", source: "assigned", profileId: "2bcd7534-e350-43a0-8e48-ca8b2de3f50f", effectiveFrom: "2026-11-01", changedWithinMonth: false, consolidatedMonthlyMinor: "30000.50" }],
    ["negative parent basic", { profile: "deputation_parent_scale", source: "assigned", profileId: "2bcd7534-e350-43a0-8e48-ca8b2de3f50f", effectiveFrom: "2026-11-01", changedWithinMonth: false, deputation: { ...deputationBlock, parentBasicMinor: "-1" } }],
    ["unknown allowance mode", { profile: "deputation_parent_scale", source: "assigned", profileId: "2bcd7534-e350-43a0-8e48-ca8b2de3f50f", effectiveFrom: "2026-11-01", changedWithinMonth: false, deputation: { ...deputationBlock, allowanceMode: "maybe" } }],
  ])("fails closed on %s", async (_label, payProfile) => {
    serve(withProfile(payProfile));
    await expect(fetchPayrollInput("t1", "2026-11")).rejects.toThrow(HrmsUnavailableError);
  });

  it("fails closed when the employees array is missing", async () => {
    serve({ month: "2026-11", lopDays: {} });
    await expect(fetchPayrollInput("t1", "2026-11")).rejects.toThrow(/hrms payroll-input invalid/);
  });
});

describe("GET /v1/payroll/internal/locked-through", () => {
  const TENANT = randomUUID();
  const OTHER = randomUUID();
  const ACTOR = randomUUID();
  const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
  let app: Awaited<ReturnType<typeof buildApp>>;

  const tok = (tid: string, roles: string[]) => signToken({ sub: ACTOR, tid, roles, sid: "s" }, SECRET);
  const insertRun = (tid: string, month: string, status: string, runType = "regular") =>
    runWithTenant(tid, () => db.transaction((tx) => tx.execute(sql`
      INSERT INTO payroll.payroll_runs (id, tenant_id, run_no, month, structure_id, run_type, status, created_by, updated_by)
      VALUES (${randomUUID()}::uuid, ${tid}::uuid, ${`R-${month}-${status}-${runType}`}, ${month}, ${randomUUID()}::uuid,
              ${runType}, ${status}, ${ACTOR}::uuid, ${ACTOR}::uuid)`)));

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => {
    for (const tid of [TENANT, OTHER]) {
      await runWithTenant(tid, () => db.transaction((tx) => tx.execute(sql`DELETE FROM payroll.payroll_runs WHERE tenant_id = ${tid}::uuid`)));
    }
    await app.close();
    await sqlClient.end();
  });

  const get = async (tid: string, roles = ["payroll_admin"]) =>
    app.inject({ method: "GET", url: "/v1/payroll/internal/locked-through", headers: { authorization: `Bearer ${tok(tid, roles)}` } });

  it("null when nothing is locked", async () => {
    const r = await get(TENANT);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ lockedThrough: null });
  });

  it("latest approved/disbursed month; ignores draft/processing/failed, pensioner runs and other tenants", async () => {
    await insertRun(TENANT, "2026-08", "disbursed");
    await insertRun(TENANT, "2026-09", "approved");
    await insertRun(TENANT, "2026-10", "processing");
    await insertRun(TENANT, "2026-11", "draft");
    await insertRun(TENANT, "2026-12", "approved", "pensioner");
    await insertRun(OTHER, "2027-05", "disbursed");
    const r = await get(TENANT);
    expect(r.json()).toEqual({ lockedThrough: "2026-09" });
  });

  it("is not open to ordinary employees", async () => {
    const r = await get(TENANT, ["employee"]);
    expect(r.statusCode).toBe(403);
  });
});
