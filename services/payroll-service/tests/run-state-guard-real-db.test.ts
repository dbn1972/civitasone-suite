import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { COMMANDS } from "../src/topics.js";
import * as repo from "../src/modules/payroll/repo.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";

// GET-side hrms enrichment is not running in this integration env (same stub as
// run-maker-checker-real-db.test.ts); the lifecycle PATCH routes do not call it.
vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, fetchPayrollReadiness: async () => new Map<string, string[]>(), fetchEmployeeSummaries: async () => new Map() };
});

/**
 * UAT L2-N3 (bundle 16): Approve was offered and ACCEPTED while a payroll run
 * was still "processing" -- the state the run sits in while its slips are being
 * computed. The run lifecycle is now draft -> processing -> computed -> approved
 * -> disbursed (processing -> failed -> draft on error), and every lifecycle
 * action is checked twice: synchronously by the command (409 with a stable code,
 * so the caller learns at once) and again by the consumer under the run row
 * lock (a command that bypassed the route, or raced a state change, is
 * dead-lettered as a non-retryable rejection and changes nothing).
 *
 * Real routes (buildApp + inject), real consumers, real Postgres (RLS), real
 * MemoryQueue -- as in run-maker-checker-real-db.test.ts.
 */
const memQueue = queue as unknown as MemoryQueue;
const SECRET = process.env.JWT_SECRET ?? "";

describe("payroll run state guards (UAT L2-N3)", () => {
  const tenantId = randomUUID();
  const creatorId = randomUUID();
  const approverId = randomUUID();
  const disburserId = randomUUID();
  const grossMinor = 5_000_000n;
  const netPayMinor = 4_200_000n;
  let seq = 0;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    registerPayrollConsumers(queue);
    await queue.start();
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await queue.stop();
    await sqlClient.end();
  });

  /** A run in `status` with one real slip; an approved run carries the slip totals, as runApprove writes them. */
  async function seedRun(status: string): Promise<string> {
    const id = randomUUID();
    seq += 1;
    const approved = status === "approved";
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await repo.insertRun(tx, {
          id, tenantId, runNo: `TEST-STATE-GUARD-${seq}`, month: `${2000 + seq}-09`,
          departmentId: null, structureId: randomUUID(), runType: "regular", ddoCode: null,
          totalGrossMinor: approved ? grossMinor : 0n, totalNetMinor: approved ? netPayMinor : 0n,
          currency: "INR", status, createdBy: creatorId, updatedBy: creatorId,
          ...(approved ? { approvedBy: approverId, approvedAt: new Date() } : {}),
        });
        await repo.insertSlip(tx, {
          id: randomUUID(), tenantId, runId: id, employeeId: randomUUID(), employeeNo: `EMP-SG-${seq}`,
          basicMinor: 3_000_000n, grossMinor, totalDeductionsMinor: grossMinor - netPayMinor, netPayMinor,
          currency: "INR", components: [{ code: "BASIC", name: "Basic", type: "earning", amountMinor: 3000000 }],
          status: "computed", createdBy: creatorId, updatedBy: creatorId,
        });
      }),
    );
    return id;
  }

  async function runRow(id: string) {
    return runWithTenant(tenantId, () => db.transaction((tx) => repo.findRunByIdTx(tx, id)));
  }

  /** PATCH /v1/payroll/runs/:id/<action> as `actorId` (super_admin), like the web does. */
  function patch(id: string, action: "approve" | "disburse" | "revert", actorId: string) {
    const token = signToken({ sub: actorId, tid: tenantId, roles: ["super_admin"], sid: randomUUID() }, SECRET);
    return app.inject({
      method: "PATCH", url: `/v1/payroll/runs/${id}/${action}`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { reason: `UAT L2-N3 state guard test (${action})` },
    });
  }

  async function expectAccepted(p: ReturnType<typeof patch>): Promise<void> {
    const res = await p;
    expect(res.statusCode, res.body).toBe(202);
    await memQueue.drain();
  }

  async function expectConflict(p: ReturnType<typeof patch>, code: string): Promise<void> {
    const res = await p;
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json().code).toBe(code);
    expect(typeof res.json().message).toBe("string");
    await memQueue.drain();
  }

  /** Publishes a lifecycle command straight onto the queue, as a replay or a caller that skipped the route would. */
  async function publishDirect(topic: string, actorId: string, payload: Record<string, unknown>): Promise<void> {
    await queue.publish(topic, {
      messageId: randomUUID(), type: topic, tenantId, actorId, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId, ...payload },
    });
    await memQueue.drain();
  }

  function dlqErrorFor(topic: string, runId: string): string | undefined {
    return memQueue.dlq.find((d) => d.topic === topic && (d.msg.payload as { id?: string }).id === runId)?.error;
  }

  describe("approve (L1)", () => {
    it("refuses a run that is still processing with 409 RUN_NOT_READY_FOR_APPROVAL and leaves it untouched", async () => {
      const id = await seedRun("processing");
      await expectConflict(patch(id, "approve", approverId), "RUN_NOT_READY_FOR_APPROVAL");
      const row = await runRow(id);
      expect(row?.status).toBe("processing");
      expect(row?.approvedAt).toBeNull();
    });

    it("refuses draft and failed runs the same way", async () => {
      await expectConflict(patch(await seedRun("draft"), "approve", approverId), "RUN_NOT_READY_FOR_APPROVAL");
      await expectConflict(patch(await seedRun("failed"), "approve", approverId), "RUN_NOT_READY_FOR_APPROVAL");
    });

    it("approves a computed run", async () => {
      const id = await seedRun("computed");
      await expectAccepted(patch(id, "approve", approverId));
      const row = await runRow(id);
      expect(row?.status).toBe("approved");
      expect(row?.approvedBy).toBe(approverId);
      expect(row?.totalNetMinor).toBe(netPayMinor);
    });

    it("refuses a second approve with 409 RUN_ALREADY_APPROVED and keeps the first approval", async () => {
      const id = await seedRun("computed");
      await expectAccepted(patch(id, "approve", approverId));
      const first = await runRow(id);
      await expectConflict(patch(id, "approve", randomUUID()), "RUN_ALREADY_APPROVED");
      await memQueue.drain();
      const after = await runRow(id);
      expect(after?.status).toBe("approved");
      expect(after?.approvedBy).toBe(approverId);
      expect(after?.version).toBe(first?.version);
    });

    it("re-checks under the run lock: an approve command for a processing run that skipped the route is rejected and changes nothing", async () => {
      const id = await seedRun("processing");
      await publishDirect(COMMANDS.runApprove, approverId, { id, approvedBy: approverId });
      expect((await runRow(id))?.status).toBe("processing");
      expect(dlqErrorFor(COMMANDS.runApprove, id)).toContain("RUN_NOT_READY_FOR_APPROVAL");
    });
  });

  describe("run read model", () => {
    it("GET /v1/payroll/runs/:id reports a computed run as computed (the state the web offers Approve in) and a processing run as processing", async () => {
      const token = signToken({ sub: approverId, tid: tenantId, roles: ["super_admin"], sid: randomUUID() }, SECRET);
      for (const status of ["computed", "processing"]) {
        const id = await seedRun(status);
        const res = await app.inject({ method: "GET", url: `/v1/payroll/runs/${id}`, headers: { authorization: `Bearer ${token}` } });
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json().status).toBe(status);
      }
    });
  });

  describe("disburse (L2)", () => {
    it("refuses a computed (not yet approved) run with 409 RUN_NOT_READY_FOR_DISBURSEMENT", async () => {
      const id = await seedRun("computed");
      await expectConflict(patch(id, "disburse", disburserId), "RUN_NOT_READY_FOR_DISBURSEMENT");
      expect((await runRow(id))?.status).toBe("computed");
    });

    it("refuses a processing run with 409 RUN_NOT_READY_FOR_DISBURSEMENT", async () => {
      const id = await seedRun("processing");
      await expectConflict(patch(id, "disburse", disburserId), "RUN_NOT_READY_FOR_DISBURSEMENT");
      expect((await runRow(id))?.status).toBe("processing");
    });

    it("re-checks under the run lock: a disburse command for a computed run that skipped the route is rejected and releases no money", async () => {
      const id = await seedRun("computed");
      await publishDirect(COMMANDS.runDisburse, disburserId, { id });
      const row = await runRow(id);
      expect(row?.status).toBe("computed");
      expect(row?.disbursedAt).toBeNull();
      expect(dlqErrorFor(COMMANDS.runDisburse, id)).toContain("RUN_NOT_READY_FOR_DISBURSEMENT");
    });

    it("disburses an approved run, then refuses a second disburse with 409 RUN_ALREADY_DISBURSED", async () => {
      const id = await seedRun("approved");
      await expectAccepted(patch(id, "disburse", disburserId));
      const row = await runRow(id);
      expect(row?.status).toBe("disbursed");
      expect(row?.disbursedAt).not.toBeNull();
      await expectConflict(patch(id, "disburse", disburserId), "RUN_ALREADY_DISBURSED");
      expect((await runRow(id))?.version).toBe(row?.version);
    });
  });

  describe("revert", () => {
    it("refuses a computed or approved run with 409 RUN_NOT_REVERTIBLE", async () => {
      const computed = await seedRun("computed");
      await expectConflict(patch(computed, "revert", approverId), "RUN_NOT_REVERTIBLE");
      expect((await runRow(computed))?.status).toBe("computed");
      const approved = await seedRun("approved");
      await expectConflict(patch(approved, "revert", approverId), "RUN_NOT_REVERTIBLE");
      expect((await runRow(approved))?.status).toBe("approved");
    });

    it("reverts a failed run to draft, then refuses a second revert", async () => {
      const id = await seedRun("failed");
      await expectAccepted(patch(id, "revert", approverId));
      expect((await runRow(id))?.status).toBe("draft");
      await expectConflict(patch(id, "revert", approverId), "RUN_NOT_REVERTIBLE");
    });

    it("re-checks under the run lock: a revert command for an approved run that skipped the route is rejected", async () => {
      const id = await seedRun("approved");
      await publishDirect(COMMANDS.runRevert, approverId, { id, revertedBy: approverId });
      expect((await runRow(id))?.status).toBe("approved");
      expect(dlqErrorFor(COMMANDS.runRevert, id)).toContain("RUN_NOT_REVERTIBLE");
    });
  });
});
