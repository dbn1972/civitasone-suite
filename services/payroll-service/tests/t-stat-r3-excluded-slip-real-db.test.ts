/**
 * T-STAT delta review of PR #2449, D-B1: a slip excluded on approval must not
 * be counted anywhere downstream. The reviewer probe: a Rs 0-basic NPS slip
 * with a fixed TA of Rs 3,600 kept an ESI row (employer Rs 117) that reached
 * the GL accrual, a TDS row, and Rs 3,600 of "salary paid" in the s.192
 * history and Form 16.
 *
 *  A. Source: approving with the exclusion removes the slip statutory ledger
 *     rows (PF / ESI / NPS / GPF / TDS) in the approval transaction, audited.
 *  B. Defence in depth: ledger rows still attached to an excluded slip (e.g.
 *     written before this fix) are ignored by every reader: employer
 *     contribution sum (GL accrual), ledger lists / summaries, TDS YTD,
 *     FY salary paid, PT YTD, Form 16, challan reconciliation, Form 24Q,
 *     NPS-SCF and the EPF ECR.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import type { FastifyInstance } from "fastify";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollInput: vi.fn(), fetchEmployeeSummaries: vi.fn() };
});
import { fetchPayrollInput, fetchEmployeeSummaries } from "../src/shared/hrms-client.js";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import * as repo from "../src/modules/payroll/repo.js";
import * as statutoryRepo from "../src/modules/statutory/repo.js";
import { registerPayrollConsumers, computeAndInsertSlip, resolveFyPaidToDateTx, resolveTdsYtdMinorsTx } from "../src/modules/payroll/consumer.js";
import { ptYtdMinors } from "../src/modules/payroll/pt-versions-repo.js";
import { approveRun } from "../src/modules/payroll/commands.js";
import { buildForm16WithMinor } from "../src/modules/tax/form16.js";
import { reconcilePeriod } from "../src/modules/statutory-returns/challan-routes.js";
import { loadPaySnapshot } from "../src/modules/fnf/pay-snapshot.js";
import { EVENTS } from "../src/topics.js";
import { payrollTdsChallan } from "../src/modules/statutory/schema.js";

const memQueue = queue as unknown as MemoryQueue;
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const R = (rupees: number): bigint => BigInt(rupees) * 100n;
type Tx = typeof db;
const creator = randomUUID();
const approver = randomUUID();
const inTenant = <T>(tenant: string, fn: (tx: Tx) => Promise<T>): Promise<T> =>
  runWithTenant(tenant, () => db.transaction(async (tx) => fn(tx as unknown as Tx)));
const q = <T = Record<string, unknown>>(tenant: string, s: ReturnType<typeof sql>) => inTenant(tenant, async (tx) => (await tx.execute(s)) as unknown as T[]);

let app: FastifyInstance;
beforeAll(async () => {
  registerPayrollConsumers(queue); await queue.start(); app = await buildApp();
  // HRMS is reachable but has nothing to add (Form 16 looks the deductee up there).
  vi.mocked(fetchPayrollInput).mockResolvedValue({ month: "2027-03", employees: [], lopDays: {}, overtimeHours: {} } as never);
});
afterAll(async () => { await queue.stop(); await app.close(); await sqlClient.end(); });

async function newRun(tenant: string, month: string, status = "computed"): Promise<string> {
  const runId = randomUUID();
  await inTenant(tenant, (tx) => repo.insertRun(tx as never, {
    id: runId, tenantId: tenant, runNo: `R3-${runId.slice(0, 8)}`, month, departmentId: null, structureId: randomUUID(), runType: "regular",
    ddoCode: null, totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status, createdBy: creator, updatedBy: creator,
  }));
  return runId;
}
const ledgerCount = async (tenant: string, slipId: string) => {
  const n: Record<string, number> = {};
  for (const t of ["payroll_pf", "payroll_esi", "payroll_nps", "payroll_gpf", "payroll_tds"]) {
    const r = await q<{ n: number }>(tenant, sql`SELECT count(*)::int AS n FROM ${sql.raw(`statutory.${t}`)} WHERE slip_id = ${slipId}::uuid`);
    n[t] = r[0]!.n;
  }
  return n;
};
const TA = [{ code: "TA", name: "Transport Allowance", type: "earning" as const, fixedMinor: R(3600) }];

describe("T-STAT D-B1 (A): approval with an exclusion removes the slip statutory rows", () => {
  it("the Rs 0-basic slip with a fixed TA leaves no ledger row, no GL accrual, no TDS / FY history, no Form 16 gross", async () => {
    const tenant = randomUUID(); const zero = randomUUID(); const paid = randomUUID();
    const runId = await newRun(tenant, "2026-08");
    await inTenant(tenant, async (tx) => {
      await computeAndInsertSlip(tx as never, { actorId: creator }, {
        runId, tenantId: tenant, employeeId: zero, employeeNo: "R3-ZERO", basicMinor: 0n, month: "2026-08", pensionScheme: "NPS",
        fyStartYear: 2026, taxRegime: "new", rawComponents: TA,
      });
      await computeAndInsertSlip(tx as never, { actorId: creator }, {
        runId, tenantId: tenant, employeeId: paid, employeeNo: "R3-PAID", basicMinor: R(50000), month: "2026-08", pensionScheme: "NPS",
        fyStartYear: 2026, taxRegime: "new", statutoryEsi: false,
      });
    });
    const slips = await runWithTenant(tenant, () => repo.listSlipsByRun(runId, tenant));
    const zeroSlip = slips.find((s) => s.employeeId === zero)!;
    // The reviewer probe, before approval: ESI (employer 3.25% of 3,600 = 117) and TDS rows exist.
    expect((await ledgerCount(tenant, zeroSlip.id)).payroll_esi).toBe(1);

    const ctx: RequestContext = { tenantId: tenant, actorId: approver, actorType: "user", roles: ["super_admin"], correlationId: randomUUID() };
    await runWithTenant(tenant, () => approveRun(ctx, runId, undefined, [{ employeeId: zero, reason: "HRMS basic pay missing" }]));
    await memQueue.drain();

    expect(await ledgerCount(tenant, zeroSlip.id)).toEqual({ payroll_pf: 0, payroll_esi: 0, payroll_nps: 0, payroll_gpf: 0, payroll_tds: 0 });
    const ev = await q<{ payload: Record<string, unknown> }>(tenant, sql`SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"}
      AND payload->>${"action"} = ${"statutory_rows_removed"} AND payload->>${"resourceId"} = ${zeroSlip.id}`);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ runId, removed: { pf: 0, esi: 1, nps: 0, gpf: 0, tds: 1 } });
    // Audit completeness: the payload rebuilds exactly what was removed (business fields only,
    // no PII beyond the employee id): ESI 0.75% / 3.25% of Rs 3,600 = 27 / 117; TDS nil.
    expect(ev[0]!.payload.removedRows).toEqual([
      { table: "payroll_esi", scheme: "ESI", slipId: zeroSlip.id, employeeId: zero, runId, period: "2026-08", currency: "INR",
        grossMinor: R(3600).toString(), empContribMinor: R(27).toString(), erContribMinor: R(117).toString() },
      { table: "payroll_tds", scheme: "TDS", slipId: zeroSlip.id, employeeId: zero, runId, period: "2026-08", currency: "INR",
        annualBasicMinor: "0", taxableMinor: "0", tdsMinor: "0" },
    ]);

    // GL accrual: only the paid slip employer NPS (14% of 50,000 = 7,000).
    const approved = await q<{ payload: { totalEmployerContribMinor: string; totalGrossMinor: string } }>(tenant, sql`
      SELECT payload FROM _outbox.messages WHERE topic = ${EVENTS.runApproved} AND payload->>${"runId"} = ${runId}`);
    expect(approved[0]!.payload.totalEmployerContribMinor).toBe(R(7000).toString());
    // Gross of the paid slip only (50,000 + HRA X 24% 12,000); the excluded Rs 3,600 is not in it.
    expect(approved[0]!.payload.totalGrossMinor).toBe(R(62000).toString());

    // s.192 history and Form 16 of the excluded employee: nothing paid, nothing deducted.
    expect((await inTenant(tenant, (tx) => resolveFyPaidToDateTx(tx, tenant, [zero], 2026, "2026-09"))).get(zero)).toBeUndefined();
    expect((await inTenant(tenant, (tx) => resolveTdsYtdMinorsTx(tx, tenant, [zero], 2026, "2026-09"))).get(zero) ?? 0n).toBe(0n);
    const f16 = await runWithTenant(tenant, () => buildForm16WithMinor(tenant, zero, "2026-27"));
    expect(f16.partBMinor.grossSalaryMinor).toBe(0n);
  });
});

describe("T-STAT D-B1 (B): ledger rows still attached to an excluded slip are ignored by every reader", () => {
  const tenant = randomUUID(); const excl = randomUUID(); const paid = randomUUID();
  let runId = ""; let exclSlip = ""; let paidSlip = "";

  beforeAll(async () => {
    runId = await newRun(tenant, "2026-08", "approved");
    await inTenant(tenant, async (tx) => {
      for (const [emp, no, status] of [[excl, "R3B-EXCL", "excluded"], [paid, "R3B-PAID", "computed"]] as const) {
        const slipId = randomUUID();
        if (emp === excl) exclSlip = slipId; else paidSlip = slipId;
        await repo.insertSlip(tx as never, {
          id: slipId, tenantId: tenant, runId, employeeId: emp, employeeNo: no, basicMinor: R(20000), grossMinor: R(20000), totalDeductionsMinor: 0n,
          netPayMinor: R(20000), currency: "INR", components: [{ code: "BASIC", name: "Basic", type: "earning", amountMinor: 2000000 }, { code: "PT", name: "Professional Tax", type: "deduction", amountMinor: 20000 }],
          status, createdBy: creator, updatedBy: creator,
        });
        const base = { tenantId: tenant, slipId, employeeId: emp, runId, currency: "INR", period: "2026-08", createdBy: creator, updatedBy: creator };
        await statutoryRepo.insertPf(tx as never, { id: randomUUID(), ...base, basicMinor: R(20000), empContribPct: "12", erContribPct: "12", empContribMinor: R(1800), erContribMinor: R(1800), epsContribMinor: R(1250), epfErContribMinor: R(550) });
        await statutoryRepo.insertEsi(tx as never, { id: randomUUID(), ...base, grossMinor: R(20000), empContribMinor: R(150), erContribMinor: R(650) });
        await statutoryRepo.insertNps(tx as never, { id: randomUUID(), ...base, basicMinor: R(20000), empContribPct: "10", erContribPct: "14", empContribMinor: R(2000), erContribMinor: R(2800) });
        await statutoryRepo.insertTds(tx as never, { id: randomUUID(), ...base, annualBasicMinor: R(240000), taxableMinor: R(1000000), tdsMinor: R(1000) });
      }
      // Challan for the paid employee TDS only: if the excluded slip TDS were still counted,
      // deducted (2,000) != deposited (1,000) and Form 24Q would stay blocked (409).
      await tx.insert(payrollTdsChallan).values({
        tenantId: tenant, period: "2026-08", bsrCode: "0510002", challanSerial: "00001", depositDate: "2026-09-07",
        cin: "0510002070920260001", tdsAmountMinor: R(1000), totalAmountMinor: R(1000), createdBy: creator,
      });
    });
    vi.mocked(fetchPayrollInput).mockResolvedValue({
      month: "2026-08", lopDays: {}, overtimeHours: {},
      // UAT b18 D3: the ECR now refuses a non-12-digit UAN, so the fixture UANs are real-shaped.
      employees: [[excl, "R3B-EXCL", "300000000001"], [paid, "R3B-PAID", "300000000002"]].map(([id, no, uan]) => ({ id, employeeNo: no, fullName: `Name ${no}`, uan, pran: `PRAN-${no}`, pan: null, basicMinor: "2000000" })),
    } as never);
    vi.mocked(fetchEmployeeSummaries).mockResolvedValue(new Map([[excl, { fullName: "Name R3B-EXCL", employeeNo: "R3B-EXCL" }], [paid, { fullName: "Name R3B-PAID", employeeNo: "R3B-PAID" }]]) as never);
  });

  it("employer contribution (GL accrual) and the ledger lists / summaries", async () => {
    expect(await inTenant(tenant, (tx) => statutoryRepo.sumEmployerContribByRunTx(tx as never, runId, tenant))).toBe(R(1800 + 650 + 2800));
    expect(await runWithTenant(tenant, () => statutoryRepo.sumEmployerContribByRun(runId, tenant))).toBe(R(1800 + 650 + 2800));
    const only = (rows: Array<{ slipId: string }>) => rows.map((r) => r.slipId);
    expect(only(await runWithTenant(tenant, () => statutoryRepo.listPfByTenant(tenant)))).toEqual([paidSlip]);
    expect(only(await runWithTenant(tenant, () => statutoryRepo.listEsiByTenant(tenant)))).toEqual([paidSlip]);
    expect(only(await runWithTenant(tenant, () => statutoryRepo.listNpsByTenant(tenant)))).toEqual([paidSlip]);
    expect(only(await runWithTenant(tenant, () => statutoryRepo.listTdsByTenant(tenant)))).toEqual([paidSlip]);
    const pf = await runWithTenant(tenant, () => statutoryRepo.summarisePfPeriod(tenant, "2026-08"));
    expect([pf.recordCount, pf.erContribMinor]).toEqual([1, R(1800)]);
    const esi = await runWithTenant(tenant, () => statutoryRepo.summariseEsiPeriod(tenant, "2026-08"));
    expect([esi.recordCount, esi.erContribMinor]).toEqual([1, R(650)]);
  });

  it("TDS YTD, FY salary paid, PT YTD, Form 16 and challan reconciliation", async () => {
    expect((await inTenant(tenant, (tx) => resolveTdsYtdMinorsTx(tx, tenant, [excl, paid], 2026, "2026-09"))).get(excl) ?? 0n).toBe(0n);
    expect((await inTenant(tenant, (tx) => resolveTdsYtdMinorsTx(tx, tenant, [excl, paid], 2026, "2026-09"))).get(paid)).toBe(R(1000));
    const fy = await inTenant(tenant, (tx) => resolveFyPaidToDateTx(tx, tenant, [excl, paid], 2026, "2026-09"));
    expect(fy.get(excl)).toBeUndefined();
    expect(fy.get(paid)?.grossMinor).toBe(R(20000));
    const pt = await inTenant(tenant, (tx) => ptYtdMinors(tx as never, tenant, [excl, paid], 2026, "2026-09"));
    expect(pt.get(excl) ?? 0n).toBe(0n);
    expect(pt.get(paid)).toBe(R(200));
    const f16 = await runWithTenant(tenant, () => buildForm16WithMinor(tenant, excl, "2026-27"));
    expect([f16.partBMinor.grossSalaryMinor, f16.partBMinor.totalTdsDeductedMinor]).toEqual([0n, 0n]);
    const rec = await runWithTenant(tenant, () => reconcilePeriod(tenant, "2026-08"));
    expect(rec.tdsDeductedMinor).toBe(R(1000).toString());
  });

  it("Form 24Q, NPS-SCF and the EPF ECR leave the excluded employee out", async () => {
    const auth = { authorization: `Bearer ${signToken({ sub: approver, tid: tenant, roles: ["super_admin"], sid: "r3" }, SECRET, 3600)}` };
    const ecr = await app.inject({ method: "GET", url: "/v1/payroll/statutory/ecr?month=2026-08", headers: auth });
    expect(ecr.statusCode).toBe(200);
    expect(ecr.body).toContain("300000000002");
    expect(ecr.body).not.toContain("300000000001");
    const nps = await app.inject({ method: "GET", url: "/v1/payroll/statutory/nps-scf?month=2026-08", headers: auth });
    expect(nps.statusCode).toBe(200);
    expect(nps.body).toContain("PRAN-R3B-PAID");
    expect(nps.body).not.toContain("PRAN-R3B-EXCL");
    const f24 = await app.inject({ method: "GET", url: "/v1/payroll/statutory/form24q?fy=2026-27&quarter=Q2", headers: auth });
    expect(f24.statusCode).toBe(200);
    expect(f24.body).toContain(paid);
    expect(f24.body).not.toContain(excl);
  });
});

describe("T-STAT D-B1 follow-up: an excluded slip never enters the F&F pay snapshot", () => {
  it("a Rs 0 excluded month is not one of the last 10 wage months (gratuity / leave encashment average)", async () => {
    const tenant = randomUUID(); const emp = randomUUID();
    for (const [month, basic, status] of [["2026-06", 40000, "computed"], ["2026-07", 0, "excluded"]] as const) {
      const runId = await newRun(tenant, month, "approved");
      await inTenant(tenant, (tx) => repo.insertSlip(tx as never, {
        id: randomUUID(), tenantId: tenant, runId, employeeId: emp, employeeNo: "R3F", basicMinor: R(basic), grossMinor: R(basic),
        totalDeductionsMinor: 0n, netPayMinor: R(basic), currency: "INR",
        components: basic ? [{ code: "BASIC", name: "Basic", type: "earning", amountMinor: basic * 100 }] : [],
        status, createdBy: creator, updatedBy: creator,
      }));
    }
    const snap = await inTenant(tenant, (tx) => loadPaySnapshot(tx as never, tenant, emp, "2026-07-31"));
    expect(snap.wageMonths).toBe(1);
    expect(snap.avgSalaryLast10MonthsMinor).toBe(R(40000).toString());
    expect(snap.lastDrawnWagesMinor).toBe(R(40000).toString());
  });
});
