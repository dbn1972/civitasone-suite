/**
 * T-STAT review of PR #2449, SHOULD-FIX 4 / 5.
 *
 *  - Back-dated arrears are visible before approval (total and per-employee
 *    list) and, above a configurable share of the regular monthly gross
 *    (payroll_settings.arrears_review_threshold_bps, default one month),
 *    need an explicit per-employee acknowledgement to approve:
 *    409 ARREARS_REVIEW_REQUIRED, same pattern as ZERO_BASIC_SLIPS.
 *  - A Rs 0-basic slip excluded on approval really leaves the run: status
 *    "excluded" (never paid, in no bank file, not marked paid on
 *    disbursement), one audit event per slip; an exclusion naming anything
 *    other than a Rs 0-basic slip of the run is rejected (422).
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
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { approveRun } from "../src/modules/payroll/commands.js";
import { getRunApprovalReview } from "../src/modules/payroll/queries.js";
import { arrearsReviewOf } from "../src/modules/payroll/domain.js";
import { HttpError } from "../src/shared/context.js";

const memQueue = queue as unknown as MemoryQueue;
const R = (rupees: number): bigint => BigInt(rupees) * 100n;
const tenantId = randomUUID();
const creator = randomUUID();
const approver = randomUUID();
const ctx = (): RequestContext => ({ tenantId, actorId: approver, actorType: "user", roles: ["super_admin"], correlationId: randomUUID() });
const asTenant = <T>(fn: () => Promise<T>) => runWithTenant(tenantId, fn);

type SlipSeed = { emp: string; no: string; basic: number; gross: number; arrear?: number };
async function seedRun(month: string, slips: SlipSeed[]): Promise<string> {
  const runId = randomUUID();
  await asTenant(() => db.transaction(async (tx) => {
    await repo.insertRun(tx, {
      id: runId, tenantId, runNo: `R2-APR-${month}`, month, departmentId: null, structureId: randomUUID(), runType: "regular",
      ddoCode: null, totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "computed", createdBy: creator, updatedBy: creator,
    });
    for (const s of slips) {
      const gross = R(s.gross + (s.arrear ?? 0));
      await repo.insertSlip(tx, {
        id: randomUUID(), tenantId, runId, employeeId: s.emp, employeeNo: s.no, basicMinor: R(s.basic), grossMinor: gross,
        totalDeductionsMinor: 0n, netPayMinor: gross, currency: "INR",
        components: [
          ...(s.basic ? [{ code: "BASIC", name: "Basic", type: "earning", amountMinor: s.basic * 100 }] : []),
          ...(s.gross - s.basic > 0 ? [{ code: "DA", name: "DA", type: "earning", amountMinor: (s.gross - s.basic) * 100 }] : []),
          ...(s.arrear ? [{ code: "ARREAR", name: "Arrears", type: "earning", amountMinor: s.arrear * 100 }] : []),
        ],
        status: "computed", createdBy: creator, updatedBy: creator,
      });
    }
  }));
  return runId;
}
const big = { emp: randomUUID(), no: "ARR-BIG", basic: 30000, gross: 50000, arrear: 60000 }; // 1.2 months of gross
const small = { emp: randomUUID(), no: "ARR-SMALL", basic: 30000, gross: 50000, arrear: 10000 };
const zero = { emp: randomUUID(), no: "ZERO-1", basic: 0, gross: 0 };

async function status(runId: string): Promise<string> {
  return (await asTenant(() => repo.findRunById(runId, tenantId)))!.status;
}
async function codeOf(p: Promise<unknown>): Promise<{ status: number; code: string; message: string } | null> {
  try { await p; return null; } catch (e) { expect(e).toBeInstanceOf(HttpError); const h = e as HttpError; return { status: h.status, code: h.code, message: h.message }; }
}

beforeAll(async () => { registerPayrollConsumers(queue); await queue.start(); });
afterAll(async () => { await queue.stop(); await sqlClient.end(); });

describe("T-STAT SF4: arrears review", () => {
  it("arrearsReviewOf: total, per-employee list, review needed above the threshold", () => {
    const slips = [big, small].map((s) => ({
      employeeId: s.emp, employeeNo: s.no, grossMinor: R(s.gross + s.arrear),
      components: [{ code: "ARREAR", type: "earning", amountMinor: s.arrear * 100 }],
    }));
    const r = arrearsReviewOf(slips, 10000);
    expect(r.totalArrearsMinor).toBe(R(70000));
    expect(r.employees.map((e) => [e.employeeNo, e.arrearsMinor, e.regularGrossMinor, e.requiresReview])).toEqual([
      ["ARR-BIG", R(60000), R(50000), true], ["ARR-SMALL", R(10000), R(50000), false],
    ]);
    expect(arrearsReviewOf(slips, 15000).employees.every((e) => !e.requiresReview)).toBe(true);
  });

  it("approval needs an acknowledgement for arrears above one month of gross; the read lists them", async () => {
    const runId = await seedRun("2026-04", [big, small]);
    const review = await asTenant(() => getRunApprovalReview(runId, tenantId));
    expect(review.arrears.totalMinor).toBe("7000000");
    expect(review.arrears.thresholdBps).toBe(10000);
    expect(review.arrears.employees.map((e) => [e.employeeNo, e.requiresReview])).toEqual([["ARR-BIG", true], ["ARR-SMALL", false]]);
    expect(review.zeroBasic).toEqual([]);

    const e = await codeOf(asTenant(() => approveRun(ctx(), runId)));
    expect(e).toMatchObject({ status: 409, code: "ARREARS_REVIEW_REQUIRED" });
    expect(e!.message).toContain("ARR-BIG");
    expect(e!.message).not.toContain("ARR-SMALL");

    await asTenant(() => approveRun(ctx(), runId, undefined, [], [{ employeeId: big.emp, reason: "Checked against the revision order" }]));
    await memQueue.drain();
    expect(await status(runId)).toBe("approved");
    const audit = await asTenant(() => db.transaction(async (tx) => (await tx.execute(sql`
      SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"} AND payload->>${"action"} = ${"approve"} AND payload->>${"resourceId"} = ${runId}`)) as unknown as Array<{ payload: Record<string, unknown> }>));
    expect(audit[0]!.payload.arrearsAcknowledgements).toEqual([{ employeeId: big.emp, reason: "Checked against the revision order" }]);
  });

  it("the threshold comes from payroll_settings", async () => {
    await asTenant(() => db.transaction((tx) => tx.execute(sql`
      INSERT INTO payroll.payroll_settings (tenant_id, arrears_review_threshold_bps) VALUES (${tenantId}::uuid, 15000)
      ON CONFLICT (tenant_id) DO UPDATE SET arrears_review_threshold_bps = 15000`)));
    const runId = await seedRun("2026-05", [big, small]);
    expect(await codeOf(asTenant(() => approveRun(ctx(), runId)))).toBeNull();
    await asTenant(() => db.transaction((tx) => tx.execute(sql`UPDATE payroll.payroll_settings SET arrears_review_threshold_bps = 10000 WHERE tenant_id = ${tenantId}::uuid`)));
  });
});

describe("T-STAT SF5: zero-basic exclusions really exclude", () => {
  it("an exclusion that is not a Rs 0-basic slip of the run is rejected (422)", async () => {
    const runId = await seedRun("2026-06", [zero, small]);
    const e = await codeOf(asTenant(() => approveRun(ctx(), runId, undefined, [
      { employeeId: zero.emp, reason: "HRMS basic missing" }, { employeeId: small.emp, reason: "not a zero slip" },
    ])));
    expect(e).toMatchObject({ status: 422, code: "INVALID_ZERO_BASIC_EXCLUSION" });
    expect(e!.message).toContain("ARR-SMALL");
  });

  it("excluded slips get status excluded, are audited, and are not marked paid on disbursement", async () => {
    const runId = await seedRun("2026-07", [zero, small]);
    const review = await asTenant(() => getRunApprovalReview(runId, tenantId));
    expect(review.zeroBasic).toEqual([{ employeeId: zero.emp, employeeNo: "ZERO-1" }]);
    await asTenant(() => approveRun(ctx(), runId, undefined, [{ employeeId: zero.emp, reason: "HRMS basic missing; fix next run" }]));
    await memQueue.drain();
    expect(await status(runId)).toBe("approved");
    const slips = await asTenant(() => repo.listSlipsByRun(runId, tenantId));
    const st = Object.fromEntries(slips.map((s) => [s.employeeNo, s.status]));
    expect(st).toEqual({ "ZERO-1": "excluded", "ARR-SMALL": "computed" });
    const ev = await asTenant(() => db.transaction(async (tx) => (await tx.execute(sql`
      SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"} AND payload->>${"action"} = ${"exclude"}
        AND payload->>${"resourceType"} = ${"payroll_slip"} AND payload->>${"runId"} = ${runId}`)) as unknown as Array<{ payload: Record<string, unknown> }>));
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ employeeId: zero.emp, reason: "HRMS basic missing; fix next run" });
    await asTenant(() => db.transaction((tx) => repo.markSlipsPaidForRun(tx, runId, approver)));
    const after = Object.fromEntries((await asTenant(() => repo.listSlipsByRun(runId, tenantId))).map((s) => [s.employeeNo, s.status]));
    expect(after).toEqual({ "ZERO-1": "excluded", "ARR-SMALL": "paid" });
  });
});
