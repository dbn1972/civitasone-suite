/**
 * HR ↔ Payroll ↔ Finance integration contract tests (MemoryQueue, no HRMS HTTP).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq, inArray } from "drizzle-orm";
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

// Fixed message IDs used in tests — must be purged from _inbox.processed between runs.
const TEST_MESSAGE_IDS = [
  "aaaaaaaa-1111-4000-8000-000000000033",
  "bbbbbbbb-2222-4000-8000-000000000033",
];

async function wipe() {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT));
  await db.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
  await db.delete(payrollLopLedger).where(eq(payrollLopLedger.tenantId, TENANT));
  // Clear idempotency keys so consumer re-processes on each test run.
  await db.delete(processed).where(inArray(processed.messageId, TEST_MESSAGE_IDS));
}

describe("HR integration consumers", () => {
  beforeAll(async () => { await wipe(); });
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("accumulates LOP days from hrms.leave.approved", async () => {
    const q = new MemoryQueue();
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

    const rows = await db.select().from(payrollLopLedger)
      .where(eq(payrollLopLedger.tenantId, TENANT));
    expect(rows.some((r) => r.lopDays === 2 && r.source === "leave")).toBe(true);
    await q.stop();
  });

  it("emits payroll.run.approved on run approve", async () => {
    const q = new MemoryQueue();
    registerPayrollConsumers(q);
    await q.start();

    await db.insert(payrollRuns).values({
      id: RUN_ID, tenantId: TENANT, runNo: "RUN/TEST", month: "2025-06",
      structureId: STRUCT, totalGrossMinor: 100n, totalNetMinor: 80n,
      currency: "INR", status: "processing",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await db.insert(payrollSlips).values({
      id: "33333333-eeee-4000-8000-000000000033",
      tenantId: TENANT, runId: RUN_ID, employeeId: EMP_ID, employeeNo: "EMP001",
      basicMinor: 100n, grossMinor: 100n, totalDeductionsMinor: 20n, netPayMinor: 80n,
      currency: "INR", components: [], status: "computed",
      createdBy: ACTOR, updatedBy: ACTOR,
    });

    await q.publish(COMMANDS.runApprove, {
      messageId: "bbbbbbbb-2222-4000-8000-000000000033",
      type: COMMANDS.runApprove,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-apr",
      schemaVersion: "1.0",
      payload: { id: RUN_ID, tenantId: TENANT, approvedBy: ACTOR },
    });

    await new Promise((r) => setTimeout(r, 600));

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    expect(outbox.some((o) => o.topic === EVENTS.runApproved)).toBe(true);
    await q.stop();
  });
});
