/**
 * DOM-004 regression: hrms.seniority.generate / hrms.seniority.approve used
 * to be `// TODO` stubs that persisted nothing yet still enqueued a
 * `success` audit event. These tests prove real persistence happens (a
 * queryable header row + ranked entries for generate; a status flip for
 * approve) and that the audit event is emitted if and only if that
 * persistence actually happened.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq, and } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Queue, Handler } from "@civitasone/queue";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsSeniorityLists, hrmsSeniorityListEntries } from "../src/modules/seniority/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerSeniorityConsumers } from "../src/modules/seniority/consumer.js";
import { COMMANDS } from "../src/topics.js";

const ACTOR   = "00000000-aaaa-4000-8000-0000000000d4";
const TENANT  = "11111111-aaaa-4000-8000-0000000000d4";
const DEPT_1  = "77777777-aaaa-4000-8000-0000000000d4";
const DESIG_1 = "88888888-bbbb-4000-8000-0000000000d4";
const EMP_1   = "22222222-bbbb-4000-8000-0000000000d4";
const EMP_2   = "22222222-cccc-4000-8000-0000000000d4";

const LIST_ID          = "44444444-dddd-4000-8000-0000000000d4";
const LIST_ID_APPROVE  = "44444444-eeee-4000-8000-0000000000d4";
const MISSING_LIST_ID  = "99999999-ffff-4000-8000-0000000000d4";

const MSG_GEN         = "aaa00001-0000-4000-8000-0000000000d4";
const MSG_GEN_DUP     = MSG_GEN; // duplicate
const MSG_APPROVE_OK  = "bbb00001-0000-4000-8000-0000000000d4";
const MSG_APPROVE_MISSING = "ccc00001-0000-4000-8000-0000000000d4";

const WAIT = 700;
const ALL_MSG_IDS = [MSG_GEN, MSG_APPROVE_OK, MSG_APPROVE_MISSING];

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

async function wipeAll() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    for (const mid of ALL_MSG_IDS) {
      await tx.delete(processed).where(eq(processed.messageId, mid));
    }
    await tx.delete(hrmsSeniorityListEntries).where(eq(hrmsSeniorityListEntries.tenantId, TENANT));
    await tx.delete(hrmsSeniorityLists).where(eq(hrmsSeniorityLists.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
  }));
}

async function seedOrg() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({
      id: DEPT_1, tenantId: TENANT, code: "DEPT-D4", name: "DOM-004 Dept",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsDesignations).values({
      id: DESIG_1, tenantId: TENANT, code: "DESIG-D4", name: "DOM-004 Designation",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsEmployees).values({
      id: EMP_1, tenantId: TENANT, employeeNo: "EMP-D4-001", fullName: "Senior One",
      departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2010-01-01",
      dateOfBirth: "1975-01-01", status: "confirmed",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsEmployees).values({
      id: EMP_2, tenantId: TENANT, employeeNo: "EMP-D4-002", fullName: "Junior Two",
      departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2018-01-01",
      dateOfBirth: "1990-01-01", status: "confirmed",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

beforeAll(async () => { await wipeAll(); await seedOrg(); });
afterAll(async () => {
  await wipeAll();
  await sqlClient.end();
});

describe("hrms.seniority.generate — real persistence (DOM-004)", () => {
  it("persists a header row + ranked entries and emits audit only after that write", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerSeniorityConsumers(q);
    await q.start();

    await q.publish(COMMANDS.seniorityGenerate, {
      messageId: MSG_GEN, type: COMMANDS.seniorityGenerate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-dom004-gen", schemaVersion: "1.0",
      payload: {
        id: LIST_ID, tenantId: TENANT, departmentId: DEPT_1,
        asOf: "2026-01-01", requestedBy: ACTOR,
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const lists = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsSeniorityLists).where(eq(hrmsSeniorityLists.id, LIST_ID))));
    expect(lists).toHaveLength(1);
    expect(lists[0]?.status).toBe("generated");
    expect(lists[0]?.entryCount).toBe(2);
    expect(lists[0]?.generatedBy).toBe(ACTOR);

    const entries = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsSeniorityListEntries)
        .where(eq(hrmsSeniorityListEntries.seniorityListId, LIST_ID))));
    expect(entries).toHaveLength(2);
    const byRank = [...entries].sort((a, b) => a.rank - b.rank);
    // EMP_1 joined 2010 (older + earlier) -> rank 1
    expect(byRank[0]?.employeeNo).toBe("EMP-D4-001");
    expect(byRank[0]?.rank).toBe(1);
    expect(byRank[1]?.employeeNo).toBe("EMP-D4-002");
    expect(byRank[1]?.rank).toBe(2);

    const outbox = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    const auditEvents = outbox.filter((m) => m.eventType === "audit.event.record");
    expect(auditEvents).toHaveLength(1);
    expect((auditEvents[0]?.payload as { resourceId?: string }).resourceId).toBe(LIST_ID);

    const proc = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(processed).where(eq(processed.messageId, MSG_GEN))));
    expect(proc).toHaveLength(1);
  });

  it("duplicate messageId is idempotent — no second row, no second audit event", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerSeniorityConsumers(q);
    await q.start();

    await q.publish(COMMANDS.seniorityGenerate, {
      messageId: MSG_GEN_DUP, type: COMMANDS.seniorityGenerate,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-dom004-gen-dup", schemaVersion: "1.0",
      payload: {
        id: LIST_ID, tenantId: TENANT, departmentId: DEPT_1,
        asOf: "2026-01-01", requestedBy: ACTOR,
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const lists = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsSeniorityLists).where(eq(hrmsSeniorityLists.id, LIST_ID))));
    expect(lists).toHaveLength(1);

    const outbox = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    const auditEvents = outbox.filter((m) => m.eventType === "audit.event.record");
    expect(auditEvents).toHaveLength(1);
  });
});

describe("hrms.seniority.approve — real persistence (DOM-004)", () => {
  it("flips a generated list to approved and emits audit only after that write", async () => {
    // Seed a second generated list directly (approve should not depend on
    // generate having run in this test process).
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(hrmsSeniorityLists).values({
        id: LIST_ID_APPROVE, tenantId: TENANT, departmentId: DEPT_1,
        asOf: "2026-01-01", status: "generated", entryCount: 0, generatedBy: ACTOR,
      });
    }));

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerSeniorityConsumers(q);
    await q.start();

    await q.publish(COMMANDS.seniorityApprove, {
      messageId: MSG_APPROVE_OK, type: COMMANDS.seniorityApprove,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-dom004-apr", schemaVersion: "1.0",
      payload: {
        id: "cmd-apr-001", tenantId: TENANT, seniorityListId: LIST_ID_APPROVE,
        approvedBy: ACTOR, remarks: "looks correct",
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    const lists = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsSeniorityLists).where(eq(hrmsSeniorityLists.id, LIST_ID_APPROVE))));
    expect(lists).toHaveLength(1);
    expect(lists[0]?.status).toBe("approved");
    expect(lists[0]?.approvedBy).toBe(ACTOR);
    expect(lists[0]?.approvedAt).not.toBeNull();
    expect(lists[0]?.remarks).toBe("looks correct");

    const outbox = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
    const auditEvents = outbox.filter((m) =>
      m.eventType === "audit.event.record" &&
      (m.payload as { resourceId?: string; action?: string }).resourceId === LIST_ID_APPROVE &&
      (m.payload as { action?: string }).action === "approve");
    expect(auditEvents).toHaveLength(1);
  });

  it("no matching list — nothing persisted, NO audit event emitted (the DOM-004 bug)", async () => {
    const before = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(and(
        eq(outboxMessages.tenantId, TENANT),
        eq(outboxMessages.eventType, "audit.event.record"),
      ))));
    const beforeCount = before.length;

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerSeniorityConsumers(q);
    await q.start();

    await q.publish(COMMANDS.seniorityApprove, {
      messageId: MSG_APPROVE_MISSING, type: COMMANDS.seniorityApprove,
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-dom004-apr-missing", schemaVersion: "1.0",
      payload: {
        id: "cmd-apr-missing", tenantId: TENANT, seniorityListId: MISSING_LIST_ID,
        approvedBy: ACTOR,
      },
    });

    await new Promise<void>((r) => setTimeout(r, WAIT));
    await q.stop();

    // markProcessed still records the message (idempotency ledger), but no
    // list row exists and — critically — no audit event was added.
    const after = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(and(
        eq(outboxMessages.tenantId, TENANT),
        eq(outboxMessages.eventType, "audit.event.record"),
      ))));
    expect(after).toHaveLength(beforeCount);

    const missing = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsSeniorityLists).where(eq(hrmsSeniorityLists.id, MISSING_LIST_ID))));
    expect(missing).toHaveLength(0);
  });
});
