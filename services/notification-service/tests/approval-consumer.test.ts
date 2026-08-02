/**
 * Template approval workflow consumers (approval/consumer.ts).
 *
 * This consumer had ZERO line coverage. It is the maker-checker gate for
 * template publication, so the branches that matter most are the ones that
 * REFUSE work: unknown template, illegal state transition, and a submitter
 * trying to approve their own template.
 *
 * Runs against the real database through runWithTenant, exactly like
 * ml-predictions-consumer.test.ts, so FORCE RLS and the outbox write are
 * exercised rather than mocked away.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray, and } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { processed, outboxMessages } from "../src/shared/outbox.js";
import { notificationTemplates } from "../src/modules/templates/schema.js";
import { registerApprovalConsumers } from "../src/modules/approval/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "b0a10001-1111-4000-8000-000000000001";
const MAKER = "b0a1aaaa-1111-4000-8000-0000000000aa";
const CHECKER = "b0a1bbbb-1111-4000-8000-0000000000bb";

const deliveredMessageIds = new Set<string>();

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(notificationTemplates).where(eq(notificationTemplates.tenantId, TENANT));
  }));
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  // _inbox.processed is shared and not tenant-scoped: only drop this file's ids.
  if (deliveredMessageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

/** Seed a template in a given approval state. */
async function seedTemplate(
  id: string,
  status: string,
  over: Partial<{ submittedBy: string }> = {},
): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(notificationTemplates).values({
      id,
      tenantId: TENANT,
      channel: "email",
      name: `tpl-${id.slice(0, 8)}`,
      subject: "Subject",
      body: "Hello {{name}}",
      status,
      contentType: "text",
      submittedBy: over.submittedBy ?? null,
      createdBy: MAKER,
      updatedBy: MAKER,
      version: 1,
    });
  }));
}

async function deliver(
  topic: string,
  messageId: string,
  payload: Record<string, unknown>,
  actorId: string = CHECKER,
): Promise<MemoryQueue> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerApprovalConsumers(q);
  await q.start();
  await q.publish(topic, {
    messageId, type: topic, tenantId: TENANT, actorId,
    correlationId: "corr-approval-1", schemaVersion: "1.0", payload,
  });
  await q.drain();
  return q;
}

async function templateById(id: string) {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(notificationTemplates).where(eq(notificationTemplates.id, id))));
  return rows[0];
}

/**
 * _outbox.messages is FORCE RLS, so this read must carry a tenant context or it
 * silently returns zero rows — the same trap the consumers themselves avoid via
 * tenantScoped().
 */
async function outboxTopics(): Promise<string[]> {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
    tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));
  return rows.map((r) => r.topic).sort();
}

beforeAll(cleanup);
beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("approval consumer — submit (draft → in_review)", () => {
  const TPL = "b0a1e001-1111-4000-8000-0000000000e1";

  it("moves a draft template to in_review and records the submitter", async () => {
    await seedTemplate(TPL, "draft");
    const q = await deliver(COMMANDS.submitTemplate, "b0a1f001-1111-4000-8000-000000000101",
      { templateId: TPL, tenantId: TENANT, submittedBy: MAKER }, MAKER);

    expect(q.dlq).toHaveLength(0);
    const row = await templateById(TPL);
    expect(row?.status).toBe("in_review");
    expect(row?.submittedBy).toBe(MAKER);
    expect(row?.submittedAt).toBeInstanceOf(Date);
  });

  it("emits the submitted event and an audit event in the same transaction", async () => {
    await seedTemplate(TPL, "draft");
    await deliver(COMMANDS.submitTemplate, "b0a1f001-1111-4000-8000-000000000102",
      { templateId: TPL, tenantId: TENANT, submittedBy: MAKER }, MAKER);

    expect(await outboxTopics()).toEqual(["audit.event.record", EVENTS.templateSubmitted].sort());
  });

  it("dead-letters when the template does not exist", async () => {
    const q = await deliver(COMMANDS.submitTemplate, "b0a1f001-1111-4000-8000-000000000103",
      { templateId: "b0a1e999-1111-4000-8000-0000000000e9", tenantId: TENANT, submittedBy: MAKER }, MAKER);

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("TEMPLATE_NOT_FOUND");
    // A refused command must not leave an event behind.
    expect(await outboxTopics()).toEqual([]);
  });

  it("dead-letters an illegal transition (already in_review cannot be submitted again)", async () => {
    await seedTemplate(TPL, "in_review");
    const q = await deliver(COMMANDS.submitTemplate, "b0a1f001-1111-4000-8000-000000000104",
      { templateId: TPL, tenantId: TENANT, submittedBy: MAKER }, MAKER);

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("INVALID_TRANSITION");
    expect((await templateById(TPL))?.status).toBe("in_review");
  });

  it("is idempotent — redelivering the same messageId does not re-run the write", async () => {
    await seedTemplate(TPL, "draft");
    const MSG = "b0a1f001-1111-4000-8000-000000000105";
    await deliver(COMMANDS.submitTemplate, MSG, { templateId: TPL, tenantId: TENANT, submittedBy: MAKER }, MAKER);
    const afterFirst = await outboxTopics();

    // Second delivery: markProcessed returns false, so the handler returns early.
    await deliver(COMMANDS.submitTemplate, MSG, { templateId: TPL, tenantId: TENANT, submittedBy: MAKER }, MAKER);
    expect(await outboxTopics()).toEqual(afterFirst);
  });
});

describe("approval consumer — approve (in_review → approved) and maker-checker", () => {
  const TPL = "b0a1e002-1111-4000-8000-0000000000e2";

  it("approves an in_review template submitted by somebody else", async () => {
    await seedTemplate(TPL, "in_review", { submittedBy: MAKER });
    const q = await deliver(COMMANDS.approveTemplate, "b0a1f002-1111-4000-8000-000000000201",
      { templateId: TPL, tenantId: TENANT, approvedBy: CHECKER });

    expect(q.dlq).toHaveLength(0);
    const row = await templateById(TPL);
    expect(row?.status).toBe("approved");
    expect(row?.approvedBy).toBe(CHECKER);
    expect(row?.approvedAt).toBeInstanceOf(Date);
    expect(await outboxTopics()).toEqual(["audit.event.record", EVENTS.templateApproved].sort());
  });

  it("refuses when the submitter approves their own template (maker-checker)", async () => {
    await seedTemplate(TPL, "in_review", { submittedBy: MAKER });
    const q = await deliver(COMMANDS.approveTemplate, "b0a1f002-1111-4000-8000-000000000202",
      { templateId: TPL, tenantId: TENANT, approvedBy: MAKER }, MAKER);

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("MAKER_CHECKER_VIOLATION");
    expect((await templateById(TPL))?.status).toBe("in_review");
    expect(await outboxTopics()).toEqual([]);
  });

  it("allows approval when submittedBy was never recorded (no maker to compare)", async () => {
    await seedTemplate(TPL, "in_review");
    const q = await deliver(COMMANDS.approveTemplate, "b0a1f002-1111-4000-8000-000000000203",
      { templateId: TPL, tenantId: TENANT, approvedBy: MAKER }, MAKER);

    expect(q.dlq).toHaveLength(0);
    expect((await templateById(TPL))?.status).toBe("approved");
  });

  it("dead-letters approving a draft template", async () => {
    await seedTemplate(TPL, "draft");
    const q = await deliver(COMMANDS.approveTemplate, "b0a1f002-1111-4000-8000-000000000204",
      { templateId: TPL, tenantId: TENANT, approvedBy: CHECKER });

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("INVALID_TRANSITION");
  });

  it("dead-letters approving a template that does not exist", async () => {
    const q = await deliver(COMMANDS.approveTemplate, "b0a1f002-1111-4000-8000-000000000205",
      { templateId: "b0a1e888-1111-4000-8000-0000000000e8", tenantId: TENANT, approvedBy: CHECKER });

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("TEMPLATE_NOT_FOUND");
  });
});

describe("approval consumer — reject (in_review → draft)", () => {
  const TPL = "b0a1e003-1111-4000-8000-0000000000e3";

  it("returns the template to draft and stores the reason", async () => {
    await seedTemplate(TPL, "in_review", { submittedBy: MAKER });
    const q = await deliver(COMMANDS.rejectTemplate, "b0a1f003-1111-4000-8000-000000000301",
      { templateId: TPL, tenantId: TENANT, rejectedBy: CHECKER, reason: "Subject line is misleading" });

    expect(q.dlq).toHaveLength(0);
    const row = await templateById(TPL);
    expect(row?.status).toBe("draft");
    expect(row?.rejectionReason).toBe("Subject line is misleading");
    expect(await outboxTopics()).toEqual(["audit.event.record", EVENTS.templateRejected].sort());
  });

  it("dead-letters rejecting an approved template", async () => {
    await seedTemplate(TPL, "approved");
    const q = await deliver(COMMANDS.rejectTemplate, "b0a1f003-1111-4000-8000-000000000302",
      { templateId: TPL, tenantId: TENANT, rejectedBy: CHECKER, reason: "too late" });

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("INVALID_TRANSITION");
  });

  it("dead-letters rejecting a template that does not exist", async () => {
    const q = await deliver(COMMANDS.rejectTemplate, "b0a1f003-1111-4000-8000-000000000303",
      { templateId: "b0a1e777-1111-4000-8000-0000000000e7", tenantId: TENANT, rejectedBy: CHECKER, reason: "x" });

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("TEMPLATE_NOT_FOUND");
  });
});

describe("approval consumer — publish (approved → published)", () => {
  const TPL = "b0a1e004-1111-4000-8000-0000000000e4";

  it("publishes an approved template", async () => {
    await seedTemplate(TPL, "approved");
    const q = await deliver(COMMANDS.publishTemplate, "b0a1f004-1111-4000-8000-000000000401",
      { templateId: TPL, tenantId: TENANT, publishedBy: CHECKER });

    expect(q.dlq).toHaveLength(0);
    expect((await templateById(TPL))?.status).toBe("published");
    expect(await outboxTopics()).toEqual(["audit.event.record", EVENTS.templatePublished].sort());
  });

  it("dead-letters publishing a template still in review", async () => {
    await seedTemplate(TPL, "in_review", { submittedBy: MAKER });
    const q = await deliver(COMMANDS.publishTemplate, "b0a1f004-1111-4000-8000-000000000402",
      { templateId: TPL, tenantId: TENANT, publishedBy: CHECKER });

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("INVALID_TRANSITION");
  });

  it("dead-letters publishing an already published template (no transition out of published)", async () => {
    await seedTemplate(TPL, "published");
    const q = await deliver(COMMANDS.publishTemplate, "b0a1f004-1111-4000-8000-000000000403",
      { templateId: TPL, tenantId: TENANT, publishedBy: CHECKER });

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("INVALID_TRANSITION");
  });

  it("dead-letters publishing a template that does not exist", async () => {
    const q = await deliver(COMMANDS.publishTemplate, "b0a1f004-1111-4000-8000-000000000404",
      { templateId: "b0a1e666-1111-4000-8000-0000000000e6", tenantId: TENANT, publishedBy: CHECKER });

    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("TEMPLATE_NOT_FOUND");
  });
});

describe("approval consumer — full lifecycle and tenant isolation", () => {
  const TPL = "b0a1e005-1111-4000-8000-0000000000e5";

  it("walks draft → in_review → approved → published", async () => {
    await seedTemplate(TPL, "draft");
    await deliver(COMMANDS.submitTemplate, "b0a1f005-1111-4000-8000-000000000501",
      { templateId: TPL, tenantId: TENANT, submittedBy: MAKER }, MAKER);
    expect((await templateById(TPL))?.status).toBe("in_review");

    await deliver(COMMANDS.approveTemplate, "b0a1f005-1111-4000-8000-000000000502",
      { templateId: TPL, tenantId: TENANT, approvedBy: CHECKER });
    expect((await templateById(TPL))?.status).toBe("approved");

    await deliver(COMMANDS.publishTemplate, "b0a1f005-1111-4000-8000-000000000503",
      { templateId: TPL, tenantId: TENANT, publishedBy: CHECKER });
    expect((await templateById(TPL))?.status).toBe("published");
  });

  it("a rejected template can be resubmitted (draft is a re-entry point)", async () => {
    await seedTemplate(TPL, "in_review", { submittedBy: MAKER });
    await deliver(COMMANDS.rejectTemplate, "b0a1f005-1111-4000-8000-000000000504",
      { templateId: TPL, tenantId: TENANT, rejectedBy: CHECKER, reason: "fix wording" });
    expect((await templateById(TPL))?.status).toBe("draft");

    const q = await deliver(COMMANDS.submitTemplate, "b0a1f005-1111-4000-8000-000000000505",
      { templateId: TPL, tenantId: TENANT, submittedBy: MAKER }, MAKER);
    expect(q.dlq).toHaveLength(0);
    expect((await templateById(TPL))?.status).toBe("in_review");
  });

  it("the template is invisible to another tenant under FORCE RLS", async () => {
    await seedTemplate(TPL, "draft");
    const other = "b0a10002-2222-4000-8000-000000000002";
    const rows = await runWithTenant(other, () => db.transaction((tx) =>
      tx.select().from(notificationTemplates).where(and(
        eq(notificationTemplates.id, TPL),
        eq(notificationTemplates.tenantId, TENANT),
      ))));
    expect(rows).toHaveLength(0);
  });
});

/**
 * Regression guard for the defect migration 0027 repairs.
 *
 * Migration 0008 added templates_status_check (active|inactive|archived) and
 * migration 0020 tried to widen it but dropped a constraint name that did not
 * exist, leaving both in place. CHECK constraints are ANDed, so the effective
 * set collapsed to {active, archived} and NO approval-workflow state could be
 * persisted — submit/approve/reject/publish were dead against a migrated DB.
 *
 * These assertions fail if that stale constraint is ever reintroduced.
 */
describe("templates.status must admit every approval-workflow state (migration 0027)", () => {
  const STATES = ["draft", "in_review", "approved", "published", "active", "archived"] as const;

  for (const status of STATES) {
    it(`accepts status "${status}"`, async () => {
      const id = `b0a1c0de-1111-4000-8000-${status.padEnd(12, "0").slice(0, 12).replace(/[^a-f0-9]/g, "0")}`;
      await seedTemplate(id, status);
      expect((await templateById(id))?.status).toBe(status);
    });
  }

  it("still rejects a status outside the permitted set", async () => {
    await expect(
      seedTemplate("b0a1c0de-1111-4000-8000-0000000000ff", "not_a_real_status"),
    ).rejects.toThrow(/chk_template_status|check constraint/i);
  });
});
