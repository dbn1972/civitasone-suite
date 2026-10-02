/**
 * PAY-PROFILES x FR 53 (suspension subsistence, #1782) composition -- real
 * DB, real run consumer. Suspension is decided FIRST and keyed on the pay
 * profile; the subsistence pay lines use the profile's basic and DA.
 *
 * 2026-11 (30 days); every employee suspended from 2026-11-16 -> 15 regular
 * days + 15 suspended days at the initial 50% subsistence rate.
 *
 *  - suspended govt_scale below the HRA floor: continuing HRA is the FLOOR
 *  - suspended Option A deputationist: parent basic + PARENT DA rate, HRA on
 *    the parent basic, DEP_ALLOW paid only for the regular days (VERIFY FR 53)
 *  - suspended consolidated / ctc_contract (assigned profiles): withheld and
 *    flagged NON_GOVERNMENT_ENGAGEMENT_WITHHELD -- the run does not fail
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn(), fetchEmployeeSummaries: vi.fn(async () => new Map()) };
});
import { fetchPayrollInput } from "../src/shared/hrms-client.js";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const STRUCTURE = randomUUID();
const DEPT = randomUUID();
const MONTH = "2026-11";
const ids = { g: randomUUID(), a: randomUUID(), c: randomUUID(), k: randomUUID() };

const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));
const q = async (s: ReturnType<typeof sql>) => (await asTenant((tx) => tx.execute(s))) as unknown as Array<Record<string, unknown>>;

const suspended = {
  paySuspended: true, subsistencePct: 50,
  suspension: { suspensionId: randomUUID(), fromDate: "2026-11-16", toDate: null, revisedSubsistencePct: null, revisedEffectiveFrom: null, reviewOrderRef: null },
};
const profile = (p: string, extra: Record<string, unknown> = {}) => ({
  profile: p, source: "assigned", profileId: randomUUID(), effectiveFrom: "2026-11-01", changedWithinMonth: false, ...extra,
});
const employee = (id: string, no: string, basic: string, city: string, scheme: string, extra: Record<string, unknown> = {}) => ({
  id, employeeNo: no, fullName: no, basicMinor: basic, dateOfJoining: "2020-01-01", payStructureId: null,
  bankAccountNo: null, bankIfsc: null, pan: null, uan: null, pran: null, cityClass: city, taxRegime: "new",
  departmentId: DEPT, pensionScheme: scheme, paymentRoute: "payroll", eligibleForPayroll: true,
  statutoryPf: true, statutoryEsi: true, statutoryNps: true, ...suspended, ...extra,
});
const FEED = [
  // no assigned profile: #1782's engagement rule (pay-scale) -> subsistence, now with the HRA floor
  employee(ids.g, "SP-G", "1500000", "X", "NPS", { payMode: "monthly", engagementType: "pay_scale" }),
  // assigned Option A, legacy "deputation" type whose pay mode is not reported: the PROFILE decides
  employee(ids.a, "SP-A", "9999900", "Y", "NPS", {
    engagementType: "deputation",
    payProfile: profile("deputation_parent_scale", { deputation: {
      id: randomUUID(), status: "active", direction: "in", option: "parent_scale", stationType: "other", parentCadre: "CSS",
      parentOrganisation: "State X", parentPayLevel: 7, parentBasicMinor: "4490000", postPayLevel: null, postBasicMinor: null,
      allowanceMode: "auto", fixedAllowanceMinor: "0", foreignService: false, parentPensionScheme: "GPF",
      daSource: "parent", parentDaRateBps: 4000, tenureFrom: "2026-01-01", tenureTo: "2029-12-31", repatriatedOn: null,
    } }),
  }),
  // assigned consolidated, engagement reported as "monthly": the PROFILE decides -> withheld
  employee(ids.c, "SP-C", "9999900", "X", "EPF", { payMode: "monthly", engagementType: "pay_scale", payProfile: profile("consolidated_contract", { consolidatedMonthlyMinor: "3000000" }) }),
  // assigned ctc_contract: withheld, and the run does NOT fail on the (unsupported) CTC plan
  employee(ids.k, "SP-K", "3000000", "X", "EPF", { payMode: "monthly", engagementType: "pay_scale", payProfile: profile("ctc_contract") }),
];

let app: FastifyInstance;
let runId = "";

beforeAll(async () => {
  const rawSubscribe = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    rawSubscribe(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerPayrollConsumers(queue);
  await queue.start();
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${TENANT}::uuid, '2026-01-01', 5500)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, is_default, status, created_by, updated_by) VALUES (${STRUCTURE}::uuid, ${TENANT}::uuid, 'SP', true, 'active', ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await tx.execute(sql`
      INSERT INTO statutory.allowance_rule_config (tenant_id, effective_from, hra_floor_x_minor, hra_floor_y_minor, hra_floor_z_minor,
        dep_allow_same_station_bps, dep_allow_same_station_cap_minor, dep_allow_other_station_bps, dep_allow_other_station_cap_minor, change_reason, created_by)
      VALUES (${TENANT}::uuid, '2026-01-01', 540000, 360000, 180000, 500, 450000, 1000, 900000, 'suspension x profile fixture', ${ACTOR}::uuid)`);
  });
  vi.mocked(fetchPayrollInput).mockResolvedValue({ month: MONTH, employees: FEED, lopDays: {}, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);
  const res = await app.inject({
    method: "POST", url: "/v1/payroll/runs",
    headers: { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_admin"], sid: "sp" }, SECRET, 3600)}`, "content-type": "application/json" },
    payload: { runNo: "SP-2026-11", month: MONTH, structureId: STRUCTURE },
  });
  expect([201, 202]).toContain(res.statusCode);
  runId = res.json().data?.id ?? res.json().id;
  const deadline = Date.now() + 30_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 250));
    const [run] = await q(sql`SELECT status, last_error FROM payroll.payroll_runs WHERE id = ${runId}::uuid`);
    const regs = await q(sql`SELECT 1 FROM payroll.payroll_register WHERE run_id = ${runId}::uuid LIMIT 1`);
    if (run?.status === "failed") throw new Error(`run failed: ${run.last_error as string}`);
    if (regs.length > 0) break;
    if (Date.now() > deadline) throw new Error("run did not settle");
  }
}, 60_000);

afterAll(async () => {
  await asTenant(async (tx) => {
    for (const t of ["statutory.payroll_pf", "statutory.payroll_esi", "statutory.payroll_tds", "statutory.payroll_gpf", "statutory.payroll_nps",
      "statutory.allowance_rule_config", "payroll.payroll_run_suspensions", "payroll.payroll_register", "payroll.payroll_slips",
      "payroll.payroll_runs", "payroll.payroll_structures", "payroll.dearness_allowance_rates"]) {
      await tx.execute(sql.raw(`DELETE FROM ${t} WHERE tenant_id = '${TENANT}'`));
    }
  });
  await app.close();
  await sqlClient.end();
});

async function slip(employeeId: string) {
  const [s] = await q(sql`SELECT basic_minor::text, components, gpf_minor::text, nps_employee_minor::text, pay_profile FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid AND employee_id = ${employeeId}::uuid`);
  return s as { basic_minor: string; components: Array<{ code: string; amountMinor: number }>; gpf_minor: string; nps_employee_minor: string; pay_profile: string } | undefined;
}
const line = (s: { components: Array<{ code: string; amountMinor: number }> }, code: string) => s.components.find((c) => c.code === code)?.amountMinor;
async function suspensionRow(employeeId: string) {
  const [r] = await q(sql`SELECT treatment, flags, regular_days, subsistence_days FROM payroll.payroll_run_suspensions WHERE run_id = ${runId}::uuid AND employee_id = ${employeeId}::uuid`);
  return r as { treatment: string; flags: string[]; regular_days: number; subsistence_days: number } | undefined;
}

describe("FR 53 subsistence x pay profile", () => {
  it("suspended govt_scale below the floor: continuing HRA is the floor (slab 4,500 -> 5,400)", async () => {
    const s = (await slip(ids.g))!;
    expect(s.pay_profile).toBe("govt_scale");
    expect(line(s, "HRA")).toBe(540000);
    expect(line(s, "BASIC")).toBe(750000);                  // 15/30 of 15,000
    expect(line(s, "SUBSISTENCE_ALLOWANCE")).toBe(375000);  // 50% x 15,000 x 15/30
    expect(await suspensionRow(ids.g)).toMatchObject({ treatment: "subsistence", regular_days: 15, subsistence_days: 15 });
  });

  it("suspended Option A deputationist: parent basic + parent DA (40%), HRA on the parent basic, DEP_ALLOW for regular days only", async () => {
    const s = (await slip(ids.a))!;
    expect(s.pay_profile).toBe("deputation_parent_scale");
    expect(s.basic_minor).toBe("2245000");                  // 44,900 x 15/30
    expect(line(s, "DA")).toBe(898000);                     // 44,900 x 15/30 x 40%  (not the central 55%)
    expect(line(s, "HRA")).toBe(808200);                    // Y tier 1 (DA 40%) 18% of 44,900, continuing in full
    expect(line(s, "DEP_ALLOW")).toBe(224500);              // min(10% x 44,900, 9,000) x 15/30
    expect(line(s, "SUBSISTENCE_ALLOWANCE")).toBe(1122500); // 50% x 44,900 x 15/30
    expect(line(s, "SA_DA")).toBe(449000);                  // 40% (parent DA) of the subsistence allowance
    expect(s.gpf_minor).toBe("314300");                     // parent GPF on regular-days Basic + DA only (31,430)
    expect(s.nps_employee_minor).toBe("0");
  });

  it("suspended consolidated and ctc_contract: withheld and flagged, no slip, run not failed", async () => {
    expect(await slip(ids.c)).toBeUndefined();
    expect(await slip(ids.k)).toBeUndefined();
    for (const id of [ids.c, ids.k]) {
      expect(await suspensionRow(id)).toMatchObject({ treatment: "withheld", flags: expect.arrayContaining(["NON_GOVERNMENT_ENGAGEMENT_WITHHELD"]) });
    }
    const [run] = await q(sql`SELECT status FROM payroll.payroll_runs WHERE id = ${runId}::uuid`);
    expect(run!.status).not.toBe("failed");
  });
});
