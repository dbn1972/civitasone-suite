/**
 * TX-005 regression: nurture-triggers.ts re-sent notifications on every
 * redelivery — it published notification.send directly (`queue.publish`)
 * with no `markProcessed` dedup guard, so a redelivered CRM event (same
 * messageId, exactly what a real queue redelivery after a crash/retry looks
 * like) fired the matching nurture notification again.
 *
 * Fix: markProcessed(tx, messageId) now gates a db.transaction wrapping the
 * rule evaluation, and the actual send goes through the transactional
 * outbox `enqueue` instead of a direct `queue.publish`. This proves a
 * redelivered crm.lead.transitioned event enqueues exactly one
 * notification.send outbox row, not two.
 */
import { describe, it, expect, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sqlClient } from "../src/shared/db.js";
import { registerNurtureConsumers } from "../src/modules/nurture/nurture-triggers.js";
import { TestQueue, cleanup, sqlAsTenant } from "./helpers/engine-harness.js";

const tenants: string[] = [];
function newTenant(): string { const t = randomUUID(); tenants.push(t); return t; }

afterEach(async () => { if (tenants.length) { await cleanup(...tenants); tenants.length = 0; } });
afterAll(async () => { await sqlClient.end(); });

async function seedRule(tenantId: string, triggerType: string, overrides: Partial<{
  threshold: number; templateId: string; channel: string;
}> = {}): Promise<string> {
  const id = randomUUID();
  const actorId = randomUUID();
  await sqlAsTenant(tenantId, sql`
    INSERT INTO workflow.nurture_rules (id, tenant_id, trigger_type, threshold, template_id, channel, enabled, created_by)
    VALUES (${id}, ${tenantId}, ${triggerType}, ${overrides.threshold ?? 0},
            ${overrides.templateId ?? randomUUID()}, ${overrides.channel ?? "email"}, true, ${actorId})
  `);
  return id;
}

async function outboxNotificationRows(tenantId: string, ruleId: string): Promise<Array<Record<string, unknown>>> {
  return sqlAsTenant(tenantId, sql`
    SELECT * FROM _outbox.messages
    WHERE tenant_id = ${tenantId} AND topic = 'notification.send' AND payload->>'ruleId' = ${ruleId}
  `);
}

describe("TX-005: nurture-triggers redelivery idempotency", () => {
  it("enqueues the notification exactly once even when the same crm.lead.transitioned message is redelivered", async () => {
    const tenantId = newTenant();
    const contactId = randomUUID();
    const q = new TestQueue();
    registerNurtureConsumers(q);

    const ruleId = await seedRule(tenantId, "stage_change");

    const messageId = randomUUID(); // same messageId on both deliveries — real redelivery
    const opts = { tenantId, messageId, correlationId: randomUUID() };
    const payload = { contactId, fromStatus: "new", toStatus: "qualified" };

    // First delivery: rule matches, notification enqueued once.
    await q.deliver("crm.lead.transitioned", payload, opts);
    let rows = await outboxNotificationRows(tenantId, ruleId);
    expect(rows).toHaveLength(1);
    expect((rows[0]!.payload as Record<string, unknown>).recipientId).toBe(contactId);

    // Redelivery: identical message, SAME messageId (the exact shape of a
    // real crash/retry redelivery) — must be a no-op, not a second send.
    await q.deliver("crm.lead.transitioned", payload, opts);
    rows = await outboxNotificationRows(tenantId, ruleId);
    expect(rows).toHaveLength(1); // still 1, not 2
  });

  it("a genuinely new message (different messageId) for the same rule still sends", async () => {
    const tenantId = newTenant();
    const contactId = randomUUID();
    const q = new TestQueue();
    registerNurtureConsumers(q);

    const ruleId = await seedRule(tenantId, "stage_change");
    const payload = { contactId, fromStatus: "new", toStatus: "qualified" };

    await q.deliver("crm.lead.transitioned", payload, { tenantId, messageId: randomUUID(), correlationId: randomUUID() });
    await q.deliver("crm.lead.transitioned", payload, { tenantId, messageId: randomUUID(), correlationId: randomUUID() });

    const rows = await outboxNotificationRows(tenantId, ruleId);
    expect(rows).toHaveLength(2); // two distinct real events, two sends
  });

  it("score_recalculated: redelivery does not double-enqueue when the rule matches", async () => {
    const tenantId = newTenant();
    const contactId = randomUUID();
    const q = new TestQueue();
    registerNurtureConsumers(q);

    const ruleId = await seedRule(tenantId, "score_below", { threshold: 50 });
    const messageId = randomUUID();
    const opts = { tenantId, messageId, correlationId: randomUUID() };
    const payload = { contactId, score: 20 }; // below threshold — matches

    await q.deliver("crm.lead.score_recalculated", payload, opts);
    await q.deliver("crm.lead.score_recalculated", payload, opts); // redelivery

    const rows = await outboxNotificationRows(tenantId, ruleId);
    expect(rows).toHaveLength(1);
  });
});
