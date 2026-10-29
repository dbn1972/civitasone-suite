import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import type { RequestContext } from "@civitasone/types";
import { db, sqlClient } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { registerPayrollConsumers } from "./consumer.js";
import { approveRun, disburseRun, revertRun } from "./commands.js";

const memQueue = queue as unknown as MemoryQueue;
const EFT_INITIATE = "finance.payment.eft.initiate";

/**
 * REGRESSION (UAT messageId scan): approve / disburse / revert used a messageId that was stable per
 * run (hash of "payroll-<action>:<runId>"). markProcessed() keys _inbox.processed on message_id alone,
 * so any second approve / disburse / revert of the same run was silently dropped (202, nothing
 * happened). The messageIds are now per invocation; double-click protection moved to the consumers
 * (row lock + status guard). This runs the REAL consumers against a REAL Postgres.
 */
describe("payroll run commands: per-command messageId + consumer duplicate guard", () => {
  const tenantId = randomUUID();
  const creatorId = randomUUID();
  const approverId = randomUUID();
  const disburserId = randomUUID();
  const structureId = randomUUID();
  const gross = 5_000_000n;
  const net = 4_200_000n;

  const ctx = (actorId: string, extra: Partial<RequestContext> = {}): RequestContext => ({
    tenantId, actorId, actorType: "user", roles: ["super_admin"], correlationId: randomUUID(), ...extra,
  }) as RequestContext;

  let monthSeq = 0;
  const nextMonth = () => `2031-${String(++monthSeq).padStart(2, "0")}`;

  async function seedRun(status: string, withSlip = true): Promise<string> {
    const runId = randomUUID();
    await runWithTenant(tenantId, () => db.transaction(async (tx) => {
      await repo.insertRun(tx, {
        id: runId, tenantId, runNo: `TEST-${runId.slice(0, 8)}`, month: nextMonth(), departmentId: null,
        structureId, runType: "regular", ddoCode: null, totalGrossMinor: 0n, totalNetMinor: 0n,
        currency: "INR", status, createdBy: creatorId, updatedBy: creatorId,
      });
      if (withSlip) {
        await repo.insertSlip(tx, {
          id: randomUUID(), tenantId, runId, employeeId: randomUUID(), employeeNo: "EMP-1",
          basicMinor: 3_000_000n, grossMinor: gross, totalDeductionsMinor: gross - net, netPayMinor: net,
          currency: "INR", components: [{ code: "BASIC", name: "Basic", type: "earning", amountMinor: 3000000 }],
          status: "computed", createdBy: creatorId, updatedBy: creatorId,
        });
      }
    }));
    return runId;
  }

  const getRun = (runId: string) =>
    runWithTenant(tenantId, () => db.transaction((tx) => repo.findRunByIdTx(tx, runId)));

  async function outboxCount(topic: string, key: "runId" | "payrollRunId", runId: string): Promise<number> {
    return runWithTenant(tenantId, () => db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT count(*)::int AS c FROM _outbox.messages
        WHERE topic = ${topic} AND payload->>${key} = ${runId}
      `)) as unknown as Array<{ c: number }>;
      return rows[0]!.c;
    }));
  }

  beforeAll(async () => {
    registerPayrollConsumers(queue);
    await queue.start();
  });
  afterAll(async () => {
    await queue.stop();
    await sqlClient.end();
  });

  it("each approve / disburse / revert invocation publishes its own messageId", async () => {
    const runId = await seedRun("processing");
    const spy = vi.spyOn(memQueue, "publish");
    await approveRun(ctx(approverId), runId);
    await approveRun(ctx(approverId), runId);
    await disburseRun(ctx(disburserId), runId);
    await disburseRun(ctx(disburserId), runId);
    await revertRun(ctx(approverId), runId);
    await revertRun(ctx(approverId), runId);
    const ids = spy.mock.calls
      .filter(([t]) => /\.run\.(approve|disburse|revert)$/.test(String(t)) || /run.*(approve|disburse|revert)/i.test(String(t)))
      .map(([, env]) => (env as { messageId: string }).messageId);
    spy.mockRestore();
    expect(ids.length).toBe(6);
    expect(new Set(ids).size).toBe(6);
    await memQueue.drain();
  });

  it("approve twice: applied once, the duplicate is a clean no-op (one accrual event, run stays approved)", async () => {
    const runId = await seedRun("processing");
    await approveRun(ctx(approverId), runId);
    await approveRun(ctx(approverId), runId);
    await memQueue.drain();
    const row = await getRun(runId);
    expect(row?.status).toBe("approved");
    expect(await outboxCount(EVENTS.runApproved, "runId", runId)).toBe(1);
  });

  it("disburse must never double-disburse: two racing + one late disburse produce exactly one EFT initiation", async () => {
    const runId = await seedRun("processing");
    await approveRun(ctx(approverId), runId);
    await memQueue.drain();
    await Promise.all([disburseRun(ctx(disburserId), runId), disburseRun(ctx(disburserId), runId)]);
    await memQueue.drain();
    await disburseRun(ctx(disburserId), runId);
    await memQueue.drain();
    const row = await getRun(runId);
    expect(row?.status).toBe("disbursed");
    expect(await outboxCount(EFT_INITIATE, "payrollRunId", runId)).toBe(1);
    expect(await outboxCount(EVENTS.runDisbursed, "runId", runId)).toBe(1);
  });

  it("disburse of a run that is not approved is still refused (guard is not a blanket no-op)", async () => {
    const runId = await seedRun("processing");
    await disburseRun(ctx(disburserId), runId);
    await memQueue.drain();
    expect((await getRun(runId))?.status).toBe("processing");
    expect(await outboxCount(EFT_INITIATE, "payrollRunId", runId)).toBe(0);
  });

  it("revert, fail again, revert again: the second revert is applied (previously dropped by the stable messageId)", async () => {
    const runId = await seedRun("failed", false);
    await revertRun(ctx(approverId), runId);
    await memQueue.drain();
    expect((await getRun(runId))?.status).toBe("draft");

    await runWithTenant(tenantId, () => db.transaction((tx) => repo.updateRun(tx, runId, { status: "failed", updatedBy: creatorId })));
    await revertRun(ctx(approverId), runId);
    await memQueue.drain();
    expect((await getRun(runId))?.status).toBe("draft");
  });

  it("a client X-Idempotency-Key still gives wire-level dedupe, scoped per action and run", async () => {
    const runId = await seedRun("processing");
    const spy = vi.spyOn(memQueue, "publish");
    const keyed = ctx(approverId, { idempotencyKey: "abc" });
    await approveRun(keyed, runId);
    await approveRun(keyed, runId);
    await revertRun(keyed, runId);
    const envs = spy.mock.calls.map(([, env]) => env as { messageId: string; type: string });
    spy.mockRestore();
    const approves = envs.filter((e) => /approve/i.test(e.type));
    const reverts = envs.filter((e) => /revert/i.test(e.type));
    expect(approves).toHaveLength(2);
    expect(approves[0]!.messageId).toBe(approves[1]!.messageId);
    expect(reverts[0]!.messageId).not.toBe(approves[0]!.messageId);
    await memQueue.drain();
  });
});
