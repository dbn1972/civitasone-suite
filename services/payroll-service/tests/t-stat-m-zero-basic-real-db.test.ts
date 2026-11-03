/**
 * T-STAT M-ZERO (F05 / F06, statutory audit 2026-11-03): 96 of 99 slips of a
 * disbursed run were Rs 0 because HRMS had no basic pay for those employees,
 * and nothing stopped the run being approved and disbursed. Each of them also
 * got an all-zero EPF row although they are NPS members (it fed the ECR).
 *
 * Now: approving a run that holds slips with no basic pay is refused
 * (409 ZERO_BASIC_SLIPS, listing the employees) unless every such employee is
 * explicitly excluded, with a reason, in the approve request; the exclusions
 * are recorded on the approval audit event. A GPF/NPS member never gets an
 * EPF row.
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
import { registerPayrollConsumers, computeAndInsertSlip } from "../src/modules/payroll/consumer.js";
import { approveRun } from "../src/modules/payroll/commands.js";
import { HttpError } from "../src/shared/context.js";

const memQueue = queue as unknown as MemoryQueue;
const R = (rupees: number): bigint => BigInt(rupees) * 100n;

const tenantId = randomUUID();
const creatorId = randomUUID();
const approverId = randomUUID();
const zeroEmp = randomUUID();
const paidEmp = randomUUID();

function ctx(): RequestContext {
  return { tenantId, actorId: approverId, actorType: "user", roles: ["super_admin"], correlationId: randomUUID() };
}

async function seedRun(month: string): Promise<string> {
  const runId = randomUUID();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await repo.insertRun(tx, {
      id: runId, tenantId, runNo: `TSTAT-ZERO-${month}`, month, departmentId: null, structureId: randomUUID(),
      runType: "regular", ddoCode: null, totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR",
      status: "processing", createdBy: creatorId, updatedBy: creatorId,
    });
    for (const [employeeId, basic] of [[zeroEmp, 0], [paidEmp, 50000]] as const) {
      await repo.insertSlip(tx, {
        id: randomUUID(), tenantId, runId, employeeId, employeeNo: employeeId === zeroEmp ? "Z-0" : "P-1",
        basicMinor: R(basic), grossMinor: R(basic), totalDeductionsMinor: 0n, netPayMinor: R(basic), currency: "INR",
        components: basic ? [{ code: "BASIC", name: "Basic", type: "earning", amountMinor: basic * 100 }] : [],
        status: "computed", createdBy: creatorId, updatedBy: creatorId,
      });
    }
  }));
  return runId;
}

async function runStatus(runId: string): Promise<string> {
  const r = await runWithTenant(tenantId, () => repo.findRunById(runId, tenantId));
  return r!.status;
}

beforeAll(async () => {
  registerPayrollConsumers(queue);
  await queue.start();
});
afterAll(async () => {
  await queue.stop();
  await sqlClient.end();
});

describe("T-STAT M-ZERO: a run with Rs 0-basic slips cannot be approved silently", () => {
  it("refuses approval with 409 ZERO_BASIC_SLIPS naming the employees", async () => {
    const runId = await seedRun("2026-04");
    const err = await runWithTenant(tenantId, () => approveRun(ctx(), runId)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect((err as HttpError).code).toBe("ZERO_BASIC_SLIPS");
    expect((err as HttpError).message).toContain("Z-0");
    await memQueue.drain();
    expect(await runStatus(runId)).toBe("processing");
  });

  it("an exclusion for a different employee does not unlock it", async () => {
    const runId = await seedRun("2026-05");
    const err = await runWithTenant(tenantId, () => approveRun(ctx(), runId, undefined, [{ employeeId: paidEmp, reason: "not the zero-basic one" }])).catch((e: unknown) => e);
    expect((err as HttpError).code).toBe("ZERO_BASIC_SLIPS");
  });

  it("approves once every Rs 0-basic employee is explicitly excluded with a reason; the exclusion is audited", async () => {
    const runId = await seedRun("2026-06");
    await runWithTenant(tenantId, () => approveRun(ctx(), runId, undefined, [{ employeeId: zeroEmp, reason: "HRMS basic pay missing; fix before next run" }]));
    await memQueue.drain();
    expect(await runStatus(runId)).toBe("approved");
    const audit = await runWithTenant(tenantId, () => db.transaction(async (tx) => (await tx.execute(sql`
      SELECT payload FROM _outbox.messages WHERE topic = ${"audit.event.record"}
        AND payload->>${"action"} = ${"approve"} AND payload->>${"resourceId"} = ${runId}
    `)) as unknown as Array<{ payload: { zeroBasicExclusions?: Array<{ employeeId: string; reason: string }> } }>));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.payload.zeroBasicExclusions).toEqual([{ employeeId: zeroEmp, reason: "HRMS basic pay missing; fix before next run" }]);
  });
});

describe("T-STAT M-ZERO (F06): no EPF row for a GPF/NPS member", () => {
  it("a Rs 0-basic NPS member gets no statutory.payroll_pf row", async () => {
    const runId = randomUUID();
    const employeeId = randomUUID();
    await runWithTenant(tenantId, () => db.transaction(async (tx) => {
      await repo.insertRun(tx, {
        id: runId, tenantId, runNo: "TSTAT-EPF", month: "2026-07", departmentId: null, structureId: randomUUID(),
        runType: "regular", ddoCode: null, totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR",
        status: "processing", createdBy: creatorId, updatedBy: creatorId,
      });
      await computeAndInsertSlip(tx, { actorId: creatorId }, {
        runId, tenantId, employeeId, employeeNo: "NPS-0", basicMinor: 0n, month: "2026-07",
        pensionScheme: "NPS", fyStartYear: 2026, taxRegime: "new",
      });
      await computeAndInsertSlip(tx, { actorId: creatorId }, {
        runId, tenantId, employeeId: randomUUID(), employeeNo: "GPF-0", basicMinor: 0n, month: "2026-07",
        pensionScheme: "GPF", fyStartYear: 2026, taxRegime: "new",
      });
    }));
    const pf = await runWithTenant(tenantId, () => db.transaction(async (tx) => (await tx.execute(sql`
      SELECT count(*)::int AS n FROM statutory.payroll_pf WHERE tenant_id = ${tenantId}::uuid AND run_id = ${runId}::uuid
    `)) as unknown as Array<{ n: number }>));
    expect(pf[0]!.n).toBe(0);
  });
});
