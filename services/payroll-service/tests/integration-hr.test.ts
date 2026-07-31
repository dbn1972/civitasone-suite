/**
 * HR ↔ Payroll ↔ Finance integration contract tests (MemoryQueue, no HRMS HTTP).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { eq, inArray } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";
import { payrollLopLedger } from "../src/modules/integration/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import { registerIntegrationConsumers } from "../src/modules/integration/consumer.js";
import { COMMANDS, CONSUMED_EVENTS, EVENTS } from "../src/topics.js";

const ACTOR  = "00000000-aaaa-4000-8000-000000000099";
const TENANT = "11111111-bbbb-4000-8000-000000000033";
const RUN_ID = "22222222-cccc-4000-8000-000000000033";
const STRUCT = "44444444-dddd-4000-8000-000000000033";
const EMP_ID = "eeeeeeee-0001-0000-0000-000000000005";
const APPROVER = "00000000-aaaa-4000-8000-000000000098"; // maker-checker: approver != creator

// Fixed message IDs used in tests — must be purged from _inbox.processed between runs.
const TEST_MESSAGE_IDS = [
  "aaaaaaaa-1111-4000-8000-000000000033",
  "bbbbbbbb-2222-4000-8000-000000000033",
];

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function wipe() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT));
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
    await tx.delete(payrollLopLedger).where(eq(payrollLopLedger.tenantId, TENANT));
    await tx.delete(processed).where(inArray(processed.messageId, TEST_MESSAGE_IDS));
  }));
}

describe("HR integration consumers", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); });

  it("accumulates LOP days from hrms.leave.approved", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerIntegrationConsumers(q);
    await q.start();

    const msgId = "aaaaaaaa-1111-4000-8000-000000000033";
    await q.publish(CONSUMED_EVENTS.leaveApproved, {
      messageId: msgId,
      type: CONSUMED_EVENTS.leaveApproved,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-lop",
      schemaVersion: "1.0",
      payload: { employeeId: EMP_ID, daysApplied: 2, fromDate: "2025-06-10" },
    });

    await new Promise((r) => setTimeout(r, 200));

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(payrollLopLedger)
        .where(eq(payrollLopLedger.tenantId, TENANT))));
    expect(rows.some((r) => r.lopDays === 2 && r.source === "leave")).toBe(true);
    await q.stop();
  });

  it("emits payroll.run.approved on run approve", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPayrollConsumers(q);
    await q.start();

    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(payrollRuns).values({
        id: RUN_ID, tenantId: TENANT, runNo: "RUN/TEST", month: "2025-06",
        structureId: STRUCT, totalGrossMinor: 100n, totalNetMinor: 80n,
        currency: "INR", status: "processing",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
      await tx.insert(payrollSlips).values({
        id: "33333333-eeee-4000-8000-000000000033",
        tenantId: TENANT, runId: RUN_ID, employeeId: EMP_ID, employeeNo: "EMP001",
        basicMinor: 100n, grossMinor: 100n, totalDeductionsMinor: 20n, netPayMinor: 80n,
        currency: "INR", components: [], status: "computed",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));

    await q.publish(COMMANDS.runApprove, {
      messageId: "bbbbbbbb-2222-4000-8000-000000000033",
      type: COMMANDS.runApprove,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-apr",
      schemaVersion: "1.0",
      payload: { id: RUN_ID, tenantId: TENANT, approvedBy: APPROVER },
    });

    await new Promise((r) => setTimeout(r, 600));

    const outbox = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    expect(outbox.some((o) => o.topic === EVENTS.runApproved)).toBe(true);

    const approved = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(payrollRuns).where(eq(payrollRuns.id, RUN_ID))));
    expect(approved[0]?.status).toBe("approved");
    expect(approved[0]?.approvedBy).toBe(APPROVER);
    await q.stop();
  });

  it("rejects self-approval (maker-checker): approver === creator keeps run in processing", async () => {
    const SELF_RUN = "55555555-aaaa-4000-8000-000000000033";
    const SELF_MSG = "66666666-bbbb-4000-8000-000000000033";
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(processed).where(eq(processed.messageId, SELF_MSG));
      await tx.insert(payrollRuns).values({
        id: SELF_RUN, tenantId: TENANT, runNo: "RUN/SELF", month: "2025-07",
        structureId: STRUCT, totalGrossMinor: 100n, totalNetMinor: 80n,
        currency: "INR", status: "processing",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }));

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerPayrollConsumers(q);
    await q.start();
    await q.publish(COMMANDS.runApprove, {
      messageId: SELF_MSG, type: COMMANDS.runApprove,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-self", schemaVersion: "1.0",
      payload: { id: SELF_RUN, tenantId: TENANT, approvedBy: ACTOR }, // approver === creator
    });
    await new Promise((r) => setTimeout(r, 600));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(payrollRuns).where(eq(payrollRuns.id, SELF_RUN))));
    expect(rows[0]?.status).toBe("processing"); // unchanged — self-approval forbidden
    expect(rows[0]?.approvedBy ?? null).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Additional integration consumer tests for coverage
// ═══════════════════════════════════════════════════════════════════════════════

describe("HR integration consumers — attendance & idempotency", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("accumulates LOP days from hrms.attendance.marked (absent)", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerIntegrationConsumers(q);
    await q.start();

    const msgId = "cccccccc-3333-4000-8000-000000000033";
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(processed).where(eq(processed.messageId, msgId));
    }));

    await q.publish(CONSUMED_EVENTS.attendanceMarked, {
      messageId: msgId,
      type: CONSUMED_EVENTS.attendanceMarked,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-att",
      schemaVersion: "1.0",
      payload: { employeeId: EMP_ID, attendanceDate: "2025-06-15", status: "absent" },
    });

    await new Promise((r) => setTimeout(r, 200));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(payrollLopLedger)
        .where(eq(payrollLopLedger.tenantId, TENANT))));
    expect(rows.some((r) => r.source === "attendance")).toBe(true);
  });

  it("skips attendance events that are not absent/half_day", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerIntegrationConsumers(q);
    await q.start();

    const msgId = "dddddddd-4444-4000-8000-000000000033";
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(processed).where(eq(processed.messageId, msgId));
      await tx.delete(payrollLopLedger).where(eq(payrollLopLedger.tenantId, TENANT));
    }));

    await q.publish(CONSUMED_EVENTS.attendanceMarked, {
      messageId: msgId,
      type: CONSUMED_EVENTS.attendanceMarked,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-att-present",
      schemaVersion: "1.0",
      payload: { employeeId: EMP_ID, attendanceDate: "2025-06-16", status: "present" },
    });

    await new Promise((r) => setTimeout(r, 200));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(payrollLopLedger)
        .where(eq(payrollLopLedger.tenantId, TENANT))));
    // No new LOP entry for "present" status
    expect(rows.filter((r) => r.employeeId === EMP_ID && r.month === "2025-06")).toHaveLength(0);
  });

  it("idempotency: duplicate message is skipped (no double LOP)", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerIntegrationConsumers(q);
    await q.start();

    const msgId = "eeeeeeee-5555-4000-8000-000000000033";
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(processed).where(eq(processed.messageId, msgId));
      await tx.delete(payrollLopLedger).where(eq(payrollLopLedger.tenantId, TENANT));
    }));

    const msg = {
      messageId: msgId,
      type: CONSUMED_EVENTS.leaveApproved,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-idem",
      schemaVersion: "1.0",
      payload: { employeeId: EMP_ID, daysApplied: 3, fromDate: "2025-07-01" },
    };

    // Publish twice
    await q.publish(CONSUMED_EVENTS.leaveApproved, msg);
    await new Promise((r) => setTimeout(r, 200));
    await q.publish(CONSUMED_EVENTS.leaveApproved, msg);
    await new Promise((r) => setTimeout(r, 200));
    await q.stop();

    const rows = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(payrollLopLedger)
        .where(eq(payrollLopLedger.tenantId, TENANT))));
    // Should only have 1 entry (3 days), not 2 entries (6 days)
    const empRows = rows.filter((r) => r.employeeId === EMP_ID && r.month === "2025-07");
    expect(empRows).toHaveLength(1);
    expect(empRows[0]?.lopDays).toBe(3);
  });

  it("handles hrms.employee.created as a no-op (idempotency registered)", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerIntegrationConsumers(q);
    await q.start();

    const msgId = "ffffffff-6666-4000-8000-000000000033";
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(processed).where(eq(processed.messageId, msgId));
    }));

    // Should not throw — just marks as processed
    await q.publish(CONSUMED_EVENTS.employeeCreated, {
      messageId: msgId,
      type: CONSUMED_EVENTS.employeeCreated,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-emp-create",
      schemaVersion: "1.0",
      payload: { employeeId: EMP_ID, fullName: "Test Employee" },
    });

    await new Promise((r) => setTimeout(r, 200));
    await q.stop();

    // Verify it was marked as processed
    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, msgId))));
    expect(proc).toHaveLength(1);
  });
});
