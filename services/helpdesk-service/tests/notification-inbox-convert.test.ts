/**
 * helpdesk-service — notification.inbox.convert_to_ticket consumer.
 *
 * Closes an orphan loop: notification-service's inbox "convert to ticket"
 * action (services/notification-service/src/modules/inbox/convert-routes.ts)
 * publishes this command with the ticket owned by helpdesk-service; before
 * this consumer, nothing subscribed and the POST always 202'd with no
 * ticket ever created.
 *
 * Mirrors the HD2 inbound-linkage tests in tests/sla-linkage.test.ts
 * (telephony.call.missed / crm.case.opened): same wireTenantAwareQueue
 * harness, same findBySource-keyed idempotency assertions. Kept in its own
 * file to avoid touching that large shared test file.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { registerTicketConsumers } from "../src/modules/tickets/consumer.js";
import { CONSUMES, SOURCE } from "../src/topics.js";
import * as repo from "../src/modules/tickets/repo.js";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const { outboxMessages } = outboxSchema;

const TENANT_A = "cccccccc-0000-4000-8000-0000000000c1";
const TENANT_B = "dddddddd-0000-4000-8000-0000000000d1";
const ACTOR = "00000000-bbbb-4000-8000-000000000099";
const ALL_TENANTS = [TENANT_A, TENANT_B];

async function cleanup() {
  for (const tenantId of ALL_TENANTS) {
    await runWithTenant(tenantId, () =>
      db.transaction(async (tx) => {
        await tx.delete(tickets).where(eq(tickets.tenantId, tenantId));
        await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
      }),
    );
  }
}

function findBySourceAsTenant(tenantId: string, source: string, sourceRef: string) {
  return runWithTenant(tenantId, () => repo.findBySource(tenantId, source, sourceRef));
}

/**
 * Poll instead of a fixed sleep — under the full suite's parallel DB load a
 * flat 50ms is not always enough for the consumer's transaction to commit.
 */
async function waitForSource(tenantId: string, source: string, sourceRef: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await findBySourceAsTenant(tenantId, source, sourceRef);
    if (row) return row;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 25));
  }
}

function wired() {
  const q = wireTenantAwareQueue(new MemoryQueue());
  registerTicketConsumers(q);
  return q;
}

function convertMsg(
  tenantId: string,
  conversationId: string,
  overrides: Record<string, unknown> = {},
  messageId = randomUUID(),
) {
  return {
    messageId, type: CONSUMES.notificationInboxConvertToTicket, tenantId, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0" as const,
    payload: {
      id: messageId, tenantId, conversationId,
      subject: "Citizen wants a refund", priority: "urgent", category: "billing",
      ...overrides,
    },
  };
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("notification.inbox.convert_to_ticket → ticket", () => {
  it("opens a linked ticket from the inbox conversation", async () => {
    const q = wired();
    const conversationId = randomUUID();
    await q.publish(CONSUMES.notificationInboxConvertToTicket, convertMsg(TENANT_A, conversationId));

    const row = await waitForSource(TENANT_A, SOURCE.emailInbox, conversationId);
    expect(row).not.toBeNull();
    expect(row!.subject).toBe("Citizen wants a refund");
    expect(row!.status).toBe("open");
    expect(row!.priority).toBe("Critical"); // "urgent" maps to helpdesk's "Critical"
    expect((row as unknown as { typeFields: Record<string, unknown> | null }).typeFields).toEqual({ category: "billing" });
  });

  it("idempotent: redelivery of the same convert command yields exactly one ticket", async () => {
    const q = wired();
    const conversationId = randomUUID();
    await q.publish(CONSUMES.notificationInboxConvertToTicket, convertMsg(TENANT_A, conversationId));
    await waitForSource(TENANT_A, SOURCE.emailInbox, conversationId);
    // A second, independently-generated command for the SAME conversation
    // (different messageId, as a real retry/duplicate delivery would be) must
    // still resolve to the one ticket already opened for it.
    const q2 = q.publish(CONSUMES.notificationInboxConvertToTicket, convertMsg(TENANT_A, conversationId));
    await q2;
    await new Promise((r) => setTimeout(r, 200)); // let the second delivery settle (no-op)

    const rows = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) =>
        tx.select().from(tickets).where(
          and(eq(tickets.tenantId, TENANT_A), eq(tickets.source, SOURCE.emailInbox), eq(tickets.sourceRef, conversationId)),
        ),
      ),
    );
    expect(rows.length).toBe(1);
  });

  it("tenant isolation: same conversationId in two tenants → two distinct tickets", async () => {
    const q = wired();
    const conversationId = randomUUID();
    await q.publish(CONSUMES.notificationInboxConvertToTicket, convertMsg(TENANT_A, conversationId));
    await q.publish(CONSUMES.notificationInboxConvertToTicket, convertMsg(TENANT_B, conversationId));

    const a = await waitForSource(TENANT_A, SOURCE.emailInbox, conversationId);
    const b = await waitForSource(TENANT_B, SOURCE.emailInbox, conversationId);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).not.toBe(b!.id);
  });

  it("maps notification priority onto helpdesk's Low/Medium/High/Critical scale", async () => {
    const q = wired();
    const conversationId = randomUUID();
    await q.publish(CONSUMES.notificationInboxConvertToTicket, convertMsg(TENANT_A, conversationId, { priority: "low" }));
    const row = await waitForSource(TENANT_A, SOURCE.emailInbox, conversationId);
    expect(row!.priority).toBe("Low");
  });
});
