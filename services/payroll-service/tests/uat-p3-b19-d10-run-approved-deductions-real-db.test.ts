/**
 * UAT P3 b19 D-10 (payroll side): payroll.run.approved used to carry only the
 * run gross / net / employer contribution, so finance booked every employee
 * deduction as one lump (gross - net) on head 2102 and could not clear TDS,
 * NPS, GPF, PT ... challan-wise. The event now also carries
 * employeeDeductionsMinor { tds, gpf, nps, pf, esi, pt, other } (paise strings,
 * run totals over non-excluded slips) whose parts always sum EXACTLY to
 * totalGrossMinor - totalNetMinor. Existing fields are unchanged.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import type { RequestContext } from "@civitasone/types";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn(), fetchEmployeeSummaries: vi.fn() };
});
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import * as repo from "../src/modules/payroll/repo.js";
import { registerPayrollConsumers, computeAndInsertSlip } from "../src/modules/payroll/consumer.js";
import { approveRun } from "../src/modules/payroll/commands.js";
import { splitEmployeeDeductions, EMPLOYEE_DEDUCTION_KEYS } from "../src/modules/payroll/run-deductions.js";
import { EVENTS } from "../src/topics.js";

const memQueue = queue as unknown as MemoryQueue;
const R = (rupees: number): bigint => BigInt(rupees) * 100n;
type Tx = typeof db;
const creator = randomUUID();
const approver = randomUUID();
const inTenant = <T>(tenant: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  runWithTenant(tenant, () => db.transaction(async (tx) => fn(tx as unknown as Tx)));
const q = <T = Record<string, unknown>>(tenant: string, s: ReturnType<typeof sql>) => inTenant(tenant, async (tx) => (await tx.execute(s)) as unknown as T[]);

beforeAll(async () => { registerPayrollConsumers(queue); await queue.start(); });
afterAll(async () => { await queue.stop(); await sqlClient.end(); });

type Deductions = Record<(typeof EMPLOYEE_DEDUCTION_KEYS)[number], string>;

describe("D-10: splitEmployeeDeductions (pure)", () => {
  it("other is the remainder, so the parts always sum to gross - net", () => {
    const r = splitEmployeeDeductions({ grossMinor: R(100000), netMinor: R(80000), tdsMinor: R(5000), gpfMinor: R(6000), npsMinor: 0n, pfMinor: 0n, esiMinor: 0n, ptMinor: R(200) });
    expect(r.parts).toEqual({ tds: "500000", gpf: "600000", nps: "0", pf: "0", esi: "0", pt: "20000", other: "880000" });
    expect(r.negativeOther).toBe(false);
  });
  it("a negative remainder still goes to other (sum kept exact) and is flagged", () => {
    const r = splitEmployeeDeductions({ grossMinor: R(1000), netMinor: R(900), tdsMinor: R(150), gpfMinor: 0n, npsMinor: 0n, pfMinor: 0n, esiMinor: 0n, ptMinor: 0n });
    expect(r.parts.other).toBe(R(-50).toString());
    expect(EMPLOYEE_DEDUCTION_KEYS.reduce((s, k) => s + BigInt(r.parts[k]), 0n)).toBe(R(100));
    expect(r.negativeOther).toBe(true);
  });
});

describe("D-10: payroll.run.approved carries the employee deductions split (real Postgres)", () => {
  it("approve a mixed GPF / NPS / EPF+ESI run with PT and an LIC recovery: parts match the ledgers and sum to gross - net; an excluded slip is left out", async () => {
    const tenant = randomUUID();
    const runId = randomUUID();
    await inTenant(tenant, (tx) => repo.insertRun(tx as never, {
      id: runId, tenantId: tenant, runNo: `D10-${runId.slice(0, 8)}`, month: "2026-08", departmentId: null, structureId: randomUUID(), runType: "regular",
      ddoCode: null, totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "computed", createdBy: creator, updatedBy: creator,
    }));
    const LIC = [{ code: "LIC", name: "LIC Premium", type: "deduction" as const, fixedMinor: R(1500) }];
    const TA = [{ code: "TA", name: "Transport Allowance", type: "earning" as const, fixedMinor: R(3600) }];
    const zero = randomUUID();
    await inTenant(tenant, async (tx) => {
      const base = { runId, tenantId: tenant, month: "2026-08", fyStartYear: 2026, taxRegime: "new" as const };
      await computeAndInsertSlip(tx as never, { actorId: creator }, { ...base, employeeId: randomUUID(), employeeNo: "D10-GPF", basicMinor: R(90000), pensionScheme: "GPF", ptMinor: R(200), rawComponents: LIC, statutoryEsi: false });
      await computeAndInsertSlip(tx as never, { actorId: creator }, { ...base, employeeId: randomUUID(), employeeNo: "D10-NPS", basicMinor: R(60000), pensionScheme: "NPS", ptMinor: R(200), statutoryEsi: false });
      await computeAndInsertSlip(tx as never, { actorId: creator }, { ...base, employeeId: randomUUID(), employeeNo: "D10-EPF", basicMinor: R(12000), pensionScheme: "EPF", statutoryEsi: true, cityClass: "Z" });
      // Rs 0-basic slip (ESI on a fixed TA) excluded on approval: none of it may reach the split.
      await computeAndInsertSlip(tx as never, { actorId: creator }, { ...base, employeeId: zero, employeeNo: "D10-ZERO", basicMinor: 0n, pensionScheme: "NPS", rawComponents: TA });
    });

    const ctx: RequestContext = { tenantId: tenant, actorId: approver, actorType: "user", roles: ["super_admin"], correlationId: randomUUID() };
    await runWithTenant(tenant, () => approveRun(ctx, runId, undefined, [{ employeeId: zero, reason: "HRMS basic pay missing" }]));
    await memQueue.drain();

    const ev = await q<{ payload: { totalGrossMinor: string; totalNetMinor: string; totalEmployerContribMinor: string; employeeDeductionsMinor: Deductions; runId: string; month: string } }>(tenant, sql`
      SELECT payload FROM _outbox.messages WHERE topic = ${EVENTS.runApproved} AND payload->>${"runId"} = ${runId}`);
    expect(ev).toHaveLength(1);
    const p = ev[0]!.payload;
    // Backward compatible: the existing fields are still there, as before.
    expect(p).toMatchObject({ runId, month: "2026-08" });
    for (const f of ["totalGrossMinor", "totalNetMinor", "totalEmployerContribMinor"] as const) expect(p[f]).toMatch(/^\d+$/);
    expect(Object.keys(p.employeeDeductionsMinor).sort()).toEqual([...EMPLOYEE_DEDUCTION_KEYS].sort());
    for (const k of EMPLOYEE_DEDUCTION_KEYS) expect(p.employeeDeductionsMinor[k]).toMatch(/^-?\d+$/);

    // The parts sum EXACTLY to gross - net.
    const sum = EMPLOYEE_DEDUCTION_KEYS.reduce((s, k) => s + BigInt(p.employeeDeductionsMinor[k]), 0n);
    expect(sum).toBe(BigInt(p.totalGrossMinor) - BigInt(p.totalNetMinor));

    // Each statutory part is the EMPLOYEE share in its ledger, non-excluded slips only.
    const ledger = async (table: string, col: string) => (await q<{ v: string }>(tenant, sql`
      SELECT COALESCE(SUM(t.${sql.raw(col)}), 0)::text AS v FROM ${sql.raw(`statutory.${table}`)} t
        JOIN payroll.payroll_slips s ON s.id = t.slip_id
       WHERE t.run_id = ${runId}::uuid AND s.status <> ${"excluded"}`))[0]!.v;
    expect(p.employeeDeductionsMinor.tds).toBe(await ledger("payroll_tds", "tds_minor"));
    expect(p.employeeDeductionsMinor.gpf).toBe(await ledger("payroll_gpf", "emp_contrib_minor"));
    expect(p.employeeDeductionsMinor.nps).toBe(await ledger("payroll_nps", "emp_contrib_minor"));
    expect(p.employeeDeductionsMinor.pf).toBe(await ledger("payroll_pf", "emp_contrib_minor"));
    expect(p.employeeDeductionsMinor.esi).toBe(await ledger("payroll_esi", "emp_contrib_minor"));
    // Each scheme really is present in this run (the test would be vacuous otherwise).
    for (const k of ["gpf", "nps", "pf", "esi"] as const) expect(BigInt(p.employeeDeductionsMinor[k])).toBeGreaterThan(0n);
    // PT is the slip PT lines (Rs 200 x 2), LIC lands in other.
    expect(p.employeeDeductionsMinor.pt).toBe(R(400).toString());
    expect(BigInt(p.employeeDeductionsMinor.other)).toBeGreaterThanOrEqual(R(1500));
    // No negative-remainder warning for a consistent run.
    const warn = await q(tenant, sql`SELECT 1 FROM _outbox.messages WHERE topic = ${"audit.event.record"}
      AND payload->>${"action"} = ${"run_deductions_split_warning"} AND payload->>${"resourceId"} = ${runId}`);
    expect(warn).toEqual([]);
  });
});
