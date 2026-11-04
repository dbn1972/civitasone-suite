/**
 * UAT T-PERIOD (2026-11-04), bundle 19 payroll -- real Postgres.
 *  D-02b  the T-PERIOD March slip (TP-EMP-01) persists TDS 0 and a positive
 *         net; a slip that pays nothing blocks approval (409
 *         NET_PAY_NON_POSITIVE) until acknowledged with a reason, which is
 *         audited; GET approval-review lists it; the deduction ceiling
 *         defaults to 75% (migration 0164).
 *  D-11   a FAILED run no longer keeps its month pending_finalisation, so TDS
 *         reconciliation (and the 24Q gate) can match; a draft run still does.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import type { RequestContext } from "@civitasone/types";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import * as repo from "../src/modules/payroll/repo.js";
import { registerPayrollConsumers, computeAndInsertSlip, resolveMaxDeductionShareBps } from "../src/modules/payroll/consumer.js";
import { approveRun } from "../src/modules/payroll/commands.js";
import { getRunApprovalReview } from "../src/modules/payroll/queries.js";
import { reconcilePeriod } from "../src/modules/statutory-returns/challan-routes.js";
import { payrollTds, payrollTdsChallan } from "../src/modules/statutory/schema.js";
import { HttpError } from "../src/shared/context.js";

const memQueue = queue as unknown as MemoryQueue;
const R = (rupees: number): bigint => BigInt(rupees) * 100n;

const tenantId = randomUUID();
const creatorId = randomUUID();
const approverId = randomUUID();
const asTenant = <T>(fn: (tx: typeof db) => Promise<T>): Promise<T> => runWithTenant(tenantId, () => db.transaction((tx) => fn(tx as unknown as typeof db)));

function ctx(): RequestContext {
  return { tenantId, actorId: approverId, actorType: "user", roles: ["super_admin"], correlationId: randomUUID() };
}

async function insertRun(month: string, status: string, runNo: string): Promise<string> {
  const id = randomUUID();
  await asTenant((tx) => repo.insertRun(tx, {
    id, tenantId, runNo, month, departmentId: null, structureId: randomUUID(), runType: "regular", ddoCode: null,
    totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status, createdBy: creatorId, updatedBy: creatorId,
  }));
  return id;
}

async function tdsRow(runId: string, period: string, tdsMinor: bigint): Promise<void> {
  await asTenant((tx) => tx.insert(payrollTds).values({
    tenantId, slipId: randomUUID(), employeeId: randomUUID(), runId, tdsMinor, period, createdBy: creatorId, updatedBy: creatorId,
  }).then(() => undefined));
}

async function challan(period: string, tdsMinor: bigint): Promise<void> {
  await asTenant((tx) => tx.insert(payrollTdsChallan).values({
    tenantId, period, bsrCode: "9999901", challanSerial: randomUUID().slice(0, 8), depositDate: `${period}-07`,
    cin: `CIN-${randomUUID().slice(0, 12)}`, tdsAmountMinor: tdsMinor, totalAmountMinor: tdsMinor, createdBy: creatorId,
  }).then(() => undefined));
}

beforeAll(async () => {
  registerPayrollConsumers(queue);
  await queue.start();
});
afterAll(async () => {
  await queue.stop();
  await sqlClient.end();
});

describe("T-PERIOD D-11: failed runs do not block TDS reconciliation / 24Q", () => {
  it("January 2027: two FAILED runs + one disbursed run, challan = TDS deducted -> matched", async () => {
    await insertRun("2027-01", "failed", "B19-JAN-F1");
    await insertRun("2027-01", "failed", "B19-JAN-F2");
    const paid = await insertRun("2027-01", "disbursed", "B19-JAN-OK");
    await tdsRow(paid, "2027-01", R(135423));
    await challan("2027-01", R(135423));
    const r = await runWithTenant(tenantId, () => reconcilePeriod(tenantId, "2027-01", "24Q"));
    expect(r.status).toBe("matched");
    expect(r.matched).toBe(true);
    expect(r.tdsDeductedMinor).toBe(R(135423).toString());
  });

  it("a month whose only run FAILED: no deduction (stray rows of the failed run ignored), nothing pending", async () => {
    const failed = await insertRun("2027-02", "failed", "B19-FEB-F1");
    await tdsRow(failed, "2027-02", R(5000));
    const r = await runWithTenant(tenantId, () => reconcilePeriod(tenantId, "2027-02", "24Q"));
    expect(r.status).toBe("matched");
    expect(r.tdsDeductedMinor).toBe("0");
  });

  it("a draft (in-flight) run still keeps the month pending_finalisation", async () => {
    await insertRun("2027-04", "failed", "B19-APR-F1");
    await insertRun("2027-04", "draft", "B19-APR-D1");
    const r = await runWithTenant(tenantId, () => reconcilePeriod(tenantId, "2027-04", "24Q"));
    expect(r.status).toBe("pending_finalisation");
    expect(r.matched).toBe(false);
  });
});

describe("T-PERIOD D-02b: March true-up and the net-pay approval guard", () => {
  it("the deduction ceiling defaults to 50% (Code on Wages s.18(2); no settings row, and the column default); disapplied -> none", async () => {
    expect(await asTenant((tx) => resolveMaxDeductionShareBps(tx, tenantId))).toBe(5000);
    await asTenant((tx) => tx.execute(sql`INSERT INTO payroll.payroll_settings (tenant_id, protected_net_floor_minor) VALUES (${tenantId}::uuid, 0) ON CONFLICT (tenant_id) DO NOTHING`));
    expect(await asTenant((tx) => resolveMaxDeductionShareBps(tx, tenantId))).toBe(5000);
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_settings SET deduction_cap_applies = false WHERE tenant_id = ${tenantId}::uuid`));
    expect(await asTenant((tx) => resolveMaxDeductionShareBps(tx, tenantId))).toBe(10000);
    await asTenant((tx) => tx.execute(sql`UPDATE payroll.payroll_settings SET deduction_cap_applies = true WHERE tenant_id = ${tenantId}::uuid`));
  });

  it("TP-EMP-01 March 2027 (Jan deducted Rs 1,35,423, 10 months presumed): slip TDS 0, net = gross - NPS, status computed", async () => {
    const runId = await insertRun("2027-03", "processing", "B19-MAR-PG");
    const employeeId = randomUUID();
    const result = await asTenant((tx) => computeAndInsertSlip(tx, { actorId: creatorId }, {
      runId, tenantId, employeeId, employeeNo: "TP-EMP-01", basicMinor: R(123100), month: "2027-03",
      pensionScheme: "NPS", daRateBps: 5800n, cityClass: "X", statutoryEsi: false, taxRegime: "new", fyStartYear: 2026,
      tdsYtdMinor: R(135423), monthsRemaining: 1, maxDeductionShareBps: 7500,
      fyPaidToDate: { grossMinor: R(231428), months: 1, unrecordedMonths: 10 } as { grossMinor: bigint; months: number },
    }));
    expect(result.tdsMinor).toBe(0n);
    expect(result.tdsExcessMinor).toBeGreaterThan(0n);
    const slips = await asTenant((tx) => repo.listSlipsByRunTx(tx, runId, tenantId));
    expect(slips).toHaveLength(1);
    expect(slips[0]!.tdsMinor).toBe(0n);
    expect(slips[0]!.netPayMinor).toBe(R(231428 - 19450));
    expect(slips[0]!.status).toBe("computed");
  });

  it("a slip paying Rs 0 blocks approval (409 NET_PAY_NON_POSITIVE), is listed by approval-review, and approves once acknowledged (audited)", async () => {
    const runId = await insertRun("2027-05", "processing", "B19-MAY");
    const zeroNetEmp = randomUUID();
    await asTenant(async (tx) => {
      await repo.insertSlip(tx, {
        id: randomUUID(), tenantId, runId, employeeId: zeroNetEmp, employeeNo: "TP-EMP-01",
        basicMinor: R(123100), grossMinor: R(231428), totalDeductionsMinor: R(290297), netPayMinor: 0n, tdsMinor: R(270847), currency: "INR",
        components: [{ code: "BASIC", name: "Basic", type: "earning", amountMinor: 12310000 }],
        status: "exception", createdBy: creatorId, updatedBy: creatorId,
      });
      await repo.insertSlip(tx, {
        id: randomUUID(), tenantId, runId, employeeId: randomUUID(), employeeNo: "TP-EMP-02",
        basicMinor: R(44900), grossMinor: R(84412), totalDeductionsMinor: R(7094), netPayMinor: R(77318), currency: "INR",
        components: [{ code: "BASIC", name: "Basic", type: "earning", amountMinor: 4490000 }],
        status: "computed", createdBy: creatorId, updatedBy: creatorId,
      });
    });

    const review = await runWithTenant(tenantId, () => getRunApprovalReview(runId, tenantId));
    expect(review.nonPositiveNet).toEqual([{ employeeId: zeroNetEmp, employeeNo: "TP-EMP-01", grossMinor: "23142800", totalDeductionsMinor: "29029700", netPayMinor: "0", tdsMinor: "27084700" }]);

    const err = await runWithTenant(tenantId, () => approveRun(ctx(), runId)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect((err as HttpError).code).toBe("NET_PAY_NON_POSITIVE");
    expect((err as HttpError).message).toContain("TP-EMP-01");
    await memQueue.drain();
    expect((await runWithTenant(tenantId, () => repo.findRunById(runId, tenantId)))!.status).toBe("processing");

    const blank = await runWithTenant(tenantId, () => approveRun(ctx(), runId, undefined, [], [], [{ employeeId: zeroNetEmp, reason: "   " }])).catch((e: unknown) => e);
    expect((blank as HttpError).code).toBe("NET_PAY_NON_POSITIVE");

    const reason = "TDS over-deducted earlier; refund via ITR, DDO informed";
    await runWithTenant(tenantId, () => approveRun(ctx(), runId, undefined, [], [], [{ employeeId: zeroNetEmp, reason }]));
    await memQueue.drain();
    expect((await runWithTenant(tenantId, () => repo.findRunById(runId, tenantId)))!.status).toBe("approved");
    const audit = await asTenant(async (tx) => (await tx.execute(sql`
      SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"}
        AND payload->>${"action"} = ${"approve"} AND payload->>${"resourceId"} = ${runId}
    `)) as unknown as Array<{ payload: { netPayAcknowledgements?: Array<{ employeeId: string; reason: string }> } }>);
    expect(audit).toHaveLength(1);
    // review nit: the acknowledged slip figures are recorded with the reason
    expect(audit[0]!.payload.netPayAcknowledgements).toEqual([{ employeeId: zeroNetEmp, reason, grossMinor: "23142800", totalDeductionsMinor: "29029700", netPayMinor: "0" }]);
  });
});
