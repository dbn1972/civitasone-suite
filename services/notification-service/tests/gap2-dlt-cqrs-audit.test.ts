import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { outboxMessages } from "@civitasone/outbox";
import { db, sqlClient } from "../src/shared/db.js";
import { dltTemplates } from "../src/modules/dlt/schema.js";
import { registerDltConsumers } from "../src/modules/dlt/consumer.js";
import { COMMANDS } from "../src/topics.js";

/**
 * GAP2-NOTIFICATIONS-DLT-10: DLT template registration must go through the
 * command bus + consumer + transactional outbox and emit an audit event in
 * the same transaction. The route no longer writes directly and emitted no
 * audit event. This test drives the create consumer and asserts BOTH the row
 * is applied by the consumer AND an audit event is enqueued — neither was true
 * before the fix (the old route INSERTed directly, with no audit at all).
 */

const TENANT = "bbbbbbbb-2222-4000-8000-0000000000d1";
const ACTOR = "cccccccc-3333-4000-8000-0000000000d1";
const TEMPLATE_ID = "33333333-4444-4000-8000-0000000000d1";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

afterAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(dltTemplates).where(eq(dltTemplates.tenantId, TENANT));
    }),
  );
  await sqlClient.end();
});

describe("DLT template create is CQRS + audited (GAP2-NOTIFICATIONS-DLT-10)", () => {
  it("the consumer applies the write and emits an audit event in the same transaction", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerDltConsumers(q);
    await q.start();

    const uniqueTemplateId = `DLT${Date.now().toString().slice(-7)}`;
    await q.publish(COMMANDS.createDltTemplate, {
      messageId: randomUUID(),
      type: COMMANDS.createDltTemplate,
      tenantId: TENANT,
      actorId: ACTOR,
      correlationId: "corr-dlt-accept",
      schemaVersion: "1.0",
      payload: {
        id: TEMPLATE_ID,
        tenantId: TENANT,
        entityId: "1001234567890",
        templateId: uniqueTemplateId,
        headerId: "MYAPP",
        contentType: "transactional",
        templateBody: "Your OTP is {#var#}.",
        channel: "sms",
      },
    });
    await new Promise<void>((r) => setTimeout(r, 300));
    await q.stop();

    // 1) The consumer (not the route) applied the write.
    const row = await runWithTenant(TENANT, () =>
      db.transaction(async (tx) => {
        const rows = await tx.select().from(dltTemplates).where(eq(dltTemplates.id, TEMPLATE_ID)).limit(1);
        return rows[0];
      }),
    );
    expect(row?.templateId).toBe(uniqueTemplateId);
    expect(row?.status).toBe("active");

    // 2) An audit event was emitted in the same transaction (outbox row).
    const auditRows = await runWithTenant(TENANT, () =>
      db
        .select()
        .from(outboxMessages)
        .where(and(eq(outboxMessages.eventType, "audit.event.record"), eq(outboxMessages.tenantId, TENANT))),
    );
    const audited = auditRows.some(
      (r) =>
        typeof r.payload === "object" &&
        r.payload !== null &&
        (r.payload as Record<string, unknown>).resourceId === TEMPLATE_ID &&
        (r.payload as Record<string, unknown>).action === "register_dlt_template",
    );
    expect(audited).toBe(true);
  });
});
