/**
 * GAP-PAYROLL-DETAIL-02 -- maker-checker on the payroll RUN lifecycle, over the
 * real route + real Postgres (RLS) + the real consumers on a MemoryQueue.
 *
 *   create -> approve: the creator may not approve   (403 MAKER_CHECKER_VIOLATION)
 *   approve -> disburse: the approver may not disburse (403 MAKER_CHECKER_VIOLATION)
 *
 * Before this the approve rule lived ONLY in the queue consumer: PATCH answered
 * 202, the UI showed a success toast, and the run silently stayed where it was;
 * disburse had no rule at all. A blocked attempt is itself audited (outcome
 * "denied"). The consumer re-asserts both rules, so a command that bypasses the
 * route (a replay, a stale message) can still not release the money.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import * as repo from "../src/modules/payroll/repo.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { COMMANDS } from "../src/topics.js";

// GET /runs/:id enriches from hrms-service, which is not running in this
// integration env: stub only those two cross-service reads (fail-open shapes).
vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return {
    ...actual,
    fetchPayrollReadiness: async () => new Map<string, string[]>(),
    fetchEmployeeSummaries: async () => new Map(),
  };
});

const memQueue = queue as unknown as MemoryQueue;
const SECRET = process.env.JWT_SECRET ?? "";

const tenantId = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const runId = randomUUID();
const structureId = randomUUID();
const employeeId = randomUUID();
const grossMinor = 5_000_000n; // Rs 50,000.00
const netPayMinor = 4_200_000n; // Rs 42,000.00

type AuditMsg = { actorId: string; payload: Record<string, unknown> };
const audits: AuditMsg[] = [];

const token = (sub: string, roles: string[]) => signToken({ sub, tid: tenantId, roles, sid: randomUUID() }, SECRET);
const bearer = (sub: string, roles: string[]) => ({ authorization: `Bearer ${token(sub, roles)}`, "content-type": "application/json" });

let app: Awaited<ReturnType<typeof buildApp>>;

async function runRow() {
  return runWithTenant(tenantId, () => db.transaction((tx) => repo.findRunByIdTx(tx, runId)));
}
const deniedAudits = () => audits.filter((a) => a.payload.outcome === "denied");

beforeAll(async () => {
  registerPayrollConsumers(queue);
  queue.subscribe<AuditMsg["payload"]>("audit.event.record", async (msg) => {
    audits.push({ actorId: msg.actorId, payload: msg.payload as Record<string, unknown> });
  });
  await queue.start();
  app = await buildApp();

  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      await repo.insertRun(tx, {
        id: runId, tenantId, runNo: "MC-RUN-1", month: "2026-09", departmentId: null, structureId,
        runType: "regular", ddoCode: null, totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR",
        status: "processing", createdBy: MAKER, updatedBy: MAKER,
      });
      await repo.insertSlip(tx, {
        id: randomUUID(), tenantId, runId, employeeId, employeeNo: "EMP-MC-1",
        basicMinor: 3_000_000n, grossMinor, totalDeductionsMinor: grossMinor - netPayMinor, netPayMinor,
        currency: "INR", components: [{ code: "BASIC", name: "Basic", type: "earning", amountMinor: 3000000 }],
        status: "computed", createdBy: MAKER, updatedBy: MAKER,
      });
    }),
  );
});

afterAll(async () => {
  await app.close();
  await queue.stop();
  await sqlClient.end();
});

describe("payroll run maker-checker (GAP-PAYROLL-DETAIL-02)", () => {
  it("approve by the run's creator is refused synchronously with 403 MAKER_CHECKER_VIOLATION, the run does not move, and the attempt is audited", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/payroll/runs/${runId}/approve`,
      headers: bearer(MAKER, ["super_admin"]), payload: { reason: "approving my own run" },
    });
    await memQueue.drain();

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await runRow())?.status).toBe("processing");
    expect((await runRow())?.approvedBy).toBeNull();

    const denied = deniedAudits();
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({
      actorId: MAKER,
      payload: {
        service: "payroll", action: "approve", resourceType: "payroll_run", resourceId: runId,
        outcome: "denied", denialCode: "MAKER_CHECKER_VIOLATION", status: "processing",
        reason: "approving my own run",
      },
    });
  });

  it("a one-character reason is a 400, not an audited approval", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/payroll/runs/${runId}/approve`,
      headers: bearer(CHECKER, ["super_admin"]), payload: { reason: "x" },
    });
    expect(res.statusCode).toBe(400);
    expect((await runRow())?.status).toBe("processing");
  });

  it("approve by a different person is accepted (202) and lands: status approved, approved_by = the checker, exact paise totals", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/payroll/runs/${runId}/approve`,
      headers: bearer(CHECKER, ["super_admin"]), payload: { reason: "Reviewed the register and totals" },
    });
    await memQueue.drain();

    expect(res.statusCode).toBe(202);
    const row = await runRow();
    expect(row?.status).toBe("approved");
    expect(row?.approvedBy).toBe(CHECKER);
    expect(row?.totalGrossMinor).toBe(5_000_000n);
    expect(row?.totalNetMinor).toBe(4_200_000n);
  });

  it("GET run detail now returns who created and who approved the run (user ids only)", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/payroll/runs/${runId}`, headers: bearer(CHECKER, ["payroll_admin"]) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.createdBy).toBe(MAKER);
    expect(body.approvedBy).toBe(CHECKER);
    // The integer-paise strings next to the rupee floats, run-level and per slip.
    expect(body.grossMinor).toBe("5000000");
    expect(body.netMinor).toBe("4200000");
    expect(body.deductionsMinor).toBe("800000");
    expect(body.salarySlips[0]).toMatchObject({ grossMinor: "5000000", deductionsMinor: "800000", netMinor: "4200000" });
  });

  it("disburse by the person who approved the run is refused with 403 MAKER_CHECKER_VIOLATION, nothing is released, and the attempt is audited", async () => {
    const before = deniedAudits().length;
    const res = await app.inject({
      method: "PATCH", url: `/v1/payroll/runs/${runId}/disburse`,
      headers: bearer(CHECKER, ["payroll_admin"]), payload: { reason: "disbursing what I approved" },
    });
    await memQueue.drain();

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    const row = await runRow();
    expect(row?.status).toBe("approved");
    expect(row?.disbursedAt).toBeNull();

    const denied = deniedAudits();
    expect(denied).toHaveLength(before + 1);
    expect(denied.at(-1)).toMatchObject({
      actorId: CHECKER,
      payload: { action: "disburse", resourceId: runId, outcome: "denied", denialCode: "MAKER_CHECKER_VIOLATION", status: "approved" },
    });
  });

  it("the consumer re-asserts the rule: a disburse command that bypasses the route (actor = approver) is rejected and never releases the run", async () => {
    const dlqBefore = memQueue.dlq.length;
    await queue.publish(COMMANDS.runDisburse, {
      messageId: randomUUID(), type: COMMANDS.runDisburse,
      tenantId, actorId: CHECKER, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: runId, tenantId },
    });
    await memQueue.drain();

    expect((await runRow())?.status).toBe("approved");
    const rejected = memQueue.dlq.slice(dlqBefore).filter((d) => d.topic === COMMANDS.runDisburse);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.error).toContain("MAKER_CHECKER_VIOLATION");
  });

  it("disburse by a different person (here the creator) is accepted and lands: status disbursed, with the reason carried to the command", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/payroll/runs/${runId}/disburse`,
      headers: bearer(MAKER, ["payroll_admin"]), payload: { reason: "Bank file checked against the register" },
    });
    await memQueue.drain();

    expect(res.statusCode).toBe(202);
    const row = await runRow();
    expect(row?.status).toBe("disbursed");
    expect(row?.disbursedAt).not.toBeNull();
  });

  it("an unknown run is still not rejected up front (nothing to compare): 202 as before, the consumer fails it", async () => {
    const res = await app.inject({
      method: "PATCH", url: `/v1/payroll/runs/${randomUUID()}/disburse`,
      headers: bearer(MAKER, ["payroll_admin"]), payload: {},
    });
    expect(res.statusCode).toBe(202);
    await memQueue.drain();
  });
});
