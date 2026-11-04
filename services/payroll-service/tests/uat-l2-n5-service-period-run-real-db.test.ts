/**
 * UAT L2-N5: the pay period an employee is in service for.
 *
 * Run 2026-08 (c5d0d979) paid an Aug slip to employees who joined on
 * 2026-10-28: the whole month was recovered as LOP on Basic + DA, but HRA was
 * still paid in full (slip 5279948a), which also put TDS Rs 54/month off.
 *
 *  - joined after the period end -> not in the run (no slip, no claim);
 *  - left before the period start -> not in the run;
 *  - joined / left inside the period -> pro rata by days in service: every
 *    pay line that accrues by the day (Basic, DA, HRA, structure allowances
 *    such as TA) is recovered for the days not in service;
 *  - leave / attendance LOP falls on Basic + DA + HRA (+ DEP_ALLOW) alike;
 *  - TDS of a pro-rata joiner projects this month net of the unpaid days.
 *
 * Real database + the real run consumer (HRMS feed mocked).
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
import { annualTaxFromTaxableMinor, stdDeduction, trueUpTdsMinor } from "../src/modules/tax/engine.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const STRUCTURE = randomUUID();
const DEPT = randomUUID();
const MONTH = "2026-08"; // 31 days; FY 2026-27, 8 months left including August
const D = 31;
const ids = { reg: randomUUID(), late: randomUUID(), gone: randomUUID(), mid: randomUUID(), out: randomUUID(), lop: randomUUID() };

// Basic Rs 1,00,000; DA 55% = 55,000; HRA (X, DA >= 50%) 30% = 30,000; TA (structure, fixed) 3,600.
const BASIC = 100_000, DA = 55_000, HRA = 30_000, TA = 3_600;
const GROSS = BASIC + DA + HRA + TA;

const tok = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "n5" }, SECRET, 3600);
const hdr = () => ({ authorization: `Bearer ${tok(["payroll_admin"])}`, "content-type": "application/json" });
const asTenant = <T>(fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(TENANT, () => db.transaction(fn));
const q = async (s: ReturnType<typeof sql>) => (await asTenant((tx) => tx.execute(s))) as unknown as Array<Record<string, unknown>>;

const employee = (id: string, no: string, dateOfJoining: string, extra: Record<string, unknown> = {}) => ({
  id, employeeNo: no, fullName: no, basicMinor: String(BASIC * 100), dateOfJoining, payStructureId: null,
  bankAccountNo: null, bankIfsc: null, pan: null, uan: null, pran: null, cityClass: "X", taxRegime: "new",
  departmentId: DEPT, pensionScheme: "NPS", paymentRoute: "payroll", eligibleForPayroll: true,
  statutoryPf: true, statutoryEsi: true, statutoryNps: true, ...extra,
});

const FEED = [
  employee(ids.reg, "N5-REG", "2020-01-01"),
  employee(ids.late, "N5-LATE", "2026-10-28"), // joins after August
  employee(ids.gone, "N5-GONE", "2019-01-01", { dateOfLeaving: "2026-07-15" }), // left before August
  employee(ids.mid, "N5-MID", "2026-08-22"), // in service 22..31 Aug = 10 days
  employee(ids.out, "N5-OUT", "2019-01-01", { dateOfLeaving: "2026-08-10" }), // in service 1..10 Aug = 10 days
  employee(ids.lop, "N5-LOP", "2020-01-01"), // 3 days leave LOP
];

let app: FastifyInstance;
let slips: Map<string, { gross: number; tds: number; comps: Record<string, number> }>;
let runId: string;

async function settle(id: string): Promise<{ status: string; last_error: string | null }> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 250));
    const [run] = await q(sql`SELECT status, last_error FROM payroll.payroll_runs WHERE id = ${id}::uuid`);
    const regs = await q(sql`SELECT 1 FROM payroll.payroll_register WHERE run_id = ${id}::uuid LIMIT 1`);
    if (run?.status === "failed" || regs.length > 0) return run as { status: string; last_error: string | null };
    if (Date.now() > deadline) throw new Error("run did not settle");
  }
}

beforeAll(async () => {
  const rawSubscribe = queue.subscribe.bind(queue);
  (queue as unknown as { subscribe: typeof queue.subscribe }).subscribe = ((topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    rawSubscribe(topic, (msg: { tenantId: string }) => runWithTenant(msg.tenantId, () => handler(msg)))) as unknown as typeof queue.subscribe;
  registerPayrollConsumers(queue);
  await queue.start();
  app = await buildApp();
  await asTenant(async (tx) => {
    await tx.execute(sql`INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps) VALUES (${TENANT}::uuid, ${"2026-01-01"}, 5500)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_structures (id, tenant_id, name, is_default, status, created_by, updated_by) VALUES (${STRUCTURE}::uuid, ${TENANT}::uuid, ${"N5"}, true, ${"active"}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
    await tx.execute(sql`INSERT INTO payroll.payroll_components (tenant_id, structure_id, code, name, component_type, fixed_minor, created_by, updated_by) VALUES (${TENANT}::uuid, ${STRUCTURE}::uuid, ${"TA"}, ${"Transport Allowance"}, ${"earning"}, ${TA * 100}, ${ACTOR}::uuid, ${ACTOR}::uuid)`);
  });
  vi.mocked(fetchPayrollInput).mockResolvedValue({ month: MONTH, employees: FEED, lopDays: { [ids.lop]: 3 }, overtimeHours: {} } as unknown as Awaited<ReturnType<typeof fetchPayrollInput>>);
  const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: hdr(), payload: { runNo: "N5-AUG", month: MONTH, structureId: STRUCTURE } });
  expect([201, 202]).toContain(res.statusCode);
  runId = res.json().data?.id ?? res.json().id;
  const run = await settle(runId);
  expect(run.status, run.last_error ?? "").not.toBe("failed");
  const rows = await q(sql`SELECT employee_id::text AS id, gross_minor::text AS gross, tds_minor::text AS tds, components FROM payroll.payroll_slips WHERE run_id = ${runId}::uuid`);
  slips = new Map(rows.map((r) => {
    const comps: Record<string, number> = {};
    for (const c of r.components as Array<{ code: string; amountMinor: number }>) comps[c.code] = (comps[c.code] ?? 0) + Number(c.amountMinor) / 100;
    return [String(r.id), { gross: Number(r.gross) / 100, tds: Number(r.tds) / 100, comps }];
  }));
});

afterAll(async () => {
  await asTenant(async (tx) => {
    for (const t of ["statutory.payroll_pf", "statutory.payroll_esi", "statutory.payroll_tds", "statutory.payroll_gpf", "statutory.payroll_nps",
      "payroll.payroll_run_employee_claims", "payroll.payroll_register", "payroll.payroll_slips", "payroll.payroll_runs",
      "payroll.payroll_components", "payroll.payroll_structures", "payroll.dearness_allowance_rates"]) {
      await tx.execute(sql`DELETE FROM ${sql.raw(t)} WHERE tenant_id = ${TENANT}::uuid`).catch(() => undefined);
    }
  });
  await app.close();
  await sqlClient.end();
});

const near = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(1);

describe("UAT L2-N5: who is in the run for the period", () => {
  it("pays the in-service employees only: a joiner after the period and a leaver before it get no slip", () => {
    expect(slips.has(ids.reg)).toBe(true);
    expect(slips.has(ids.mid)).toBe(true);
    expect(slips.has(ids.out)).toBe(true);
    expect(slips.has(ids.lop)).toBe(true);
    expect(slips.has(ids.late)).toBe(false);
    expect(slips.has(ids.gone)).toBe(false);
    expect(slips.size).toBe(4);
  });

  it("does not claim the excluded employees for the period (they stay free for their own run)", async () => {
    const claimed = await q(sql`SELECT employee_id::text AS id FROM payroll.payroll_run_employee_claims WHERE run_id = ${runId}::uuid`);
    const got = new Set(claimed.map((c) => String(c.id)));
    expect(got.has(ids.late)).toBe(false);
    expect(got.has(ids.gone)).toBe(false);
    expect(got.has(ids.reg)).toBe(true);
  });

  it("records the excluded employees on the run audit trail", async () => {
    const rows = await q(sql`SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"} AND payload->>${"resourceId"} = ${runId} AND payload->>${"action"} = ${"warning"} AND payload->>${"code"} = ${"EMPLOYEES_NOT_IN_SERVICE"}`);
    expect(rows).toHaveLength(1);
    const warn = rows[0]!.payload as { count: number; employees: Array<{ employee: string; reason: string }> };
    expect(warn.count).toBe(2);
    expect(warn.employees).toEqual(expect.arrayContaining([
      { employee: "N5-LATE", reason: "joined_after_period" },
      { employee: "N5-GONE", reason: "left_before_period" },
    ]));
  });

  it("pays a full month unchanged to an employee in service all month", () => {
    const s = slips.get(ids.reg)!;
    expect(s.comps).toMatchObject({ BASIC, DA, HRA, TA });
    expect(s.comps.LOP).toBeUndefined();
    expect(s.gross).toBe(GROSS);
  });

  it("pays a mid-period joiner pro rata: Basic, DA, HRA and TA all fall for the 21 days before joining", () => {
    const s = slips.get(ids.mid)!;
    near(s.comps.LOP, (GROSS * 21) / D);
    // what is actually paid is 10/31 of every line, HRA included
    near(s.gross - s.comps.LOP, (GROSS * 10) / D);
    expect(s.comps.LOP).toBeGreaterThan(((BASIC + DA) * 21) / D + 1); // HRA is no longer paid for days not in service
  });

  it("pays a mid-period leaver pro rata for the 10 days up to the date of leaving", () => {
    const s = slips.get(ids.out)!;
    near(s.comps.LOP, (GROSS * 21) / D);
    near(s.gross - s.comps.LOP, (GROSS * 10) / D);
  });

  it("recovers leave LOP on Basic + DA + HRA alike (TA carries no LOP flag and is paid in full)", () => {
    const s = slips.get(ids.lop)!;
    near(s.comps.LOP, ((BASIC + DA + HRA) * 3) / D);
  });

  it("projects TDS for the pro-rata joiner on what this month actually pays (s.192)", () => {
    const s = slips.get(ids.mid)!;
    const lopMinor = BigInt(Math.round(s.comps.LOP * 100));
    const regular = BigInt(GROSS * 100);
    // no earlier FY month in service (joined in August): this month net of LOP + 7 regular months
    const annual = (regular - lopMinor) + regular * 7n;
    const taxable = annual - BigInt(stdDeduction("new", 2026)) * 100n;
    const expected = trueUpTdsMinor(annualTaxFromTaxableMinor(taxable, "new", 2026), 0n, 8);
    expect(BigInt(Math.round(s.tds * 100))).toBe(expected);
    // and a full-month employee (in service all FY: Apr-Jul estimated at the regular pay) is not affected
    const full = slips.get(ids.reg)!;
    const fullTaxable = regular * 12n - BigInt(stdDeduction("new", 2026)) * 100n;
    expect(BigInt(Math.round(full.tds * 100))).toBe(trueUpTdsMinor(annualTaxFromTaxableMinor(fullTaxable, "new", 2026), 0n, 8));
  });
});
