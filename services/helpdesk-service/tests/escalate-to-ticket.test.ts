/**
 * helpdesk-service — LOOP 1: escalate-to-ticket (knowledge assistant → helpdesk).
 *
 * knowledge-service's assistant emits `helpdesk.ticket.create` (COMMANDS.createTicket)
 * with a foreign payload shape: no pre-assigned id/status, but a source
 * ("knowledge_assistant") + externalRef. The helpdesk create consumer must open a
 * real ticket via the SAME idempotent linked-insert path used for telephony/crm and
 * emit `helpdesk.ticket.created`. DB-backed against live civitas_helpdesk.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { registerTicketConsumers } from "../src/modules/tickets/consumer.js";
import { COMMANDS, EVENTS, SOURCE } from "../src/topics.js";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import * as repo from "../src/modules/tickets/repo.js";

const { outboxMessages } = outboxSchema;

const TENANT_A = "aaaaaaaa-0000-4000-8000-00000000ea01";
const TENANT_B = "bbbbbbbb-0000-4000-8000-00000000eb01";
const ACTOR = "00000000-aaaa-4000-8000-0000000000e9";
const ALL_TENANTS = [TENANT_A, TENANT_B];

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

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

async function outboxFor(tenantId: string, needle: string) {
  const rows = await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenantId))),
  );
  return rows.filter((r) => JSON.stringify(r.payload).includes(needle));
}

/** Message mirroring knowledge-service's assistant.escalate() emit payload. */
function escalateMsg(tenantId: string, externalRef: string, messageId = randomUUID()) {
  return {
    messageId, type: COMMANDS.createTicket, tenantId, actorId: ACTOR,
    correlationId: randomUUID(), schemaVersion: "1.0" as const,
    payload: {
      subject: "How do I reset my pension portal password?",
      description: "Assistant could not answer; user requested a human.",
      priority: "High",
      source: SOURCE.assistant,
      externalRef,
    },
  };
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("LOOP 1 — escalate-to-ticket consumer (helpdesk.ticket.create → ticket)", () => {
  function wired() {
    const q = wireTenantAwareQueue(new MemoryQueue());
    registerTicketConsumers(q);
    return q;
  }

  it("opens a real ticket from an assistant escalation and emits ticketCreated", async () => {
    const q = wired();
    const ref = randomUUID();
    await q.publish(COMMANDS.createTicket, escalateMsg(TENANT_A, ref));
    await new Promise((r) => setTimeout(r, 200));

    const row = await findBySourceAsTenant(TENANT_A, SOURCE.assistant, ref);
    expect(row).not.toBeNull();
    expect(row!.source).toBe("knowledge_assistant");
    expect(row!.sourceRef).toBe(ref);
    expect(row!.status).toBe("open");
    expect(row!.priority).toBe("High");
    expect(row!.subject).toContain("pension portal");

    const emitted = await outboxFor(TENANT_A, row!.id);
    const topics = emitted.map((m) => m.topic);
    expect(topics).toContain(EVENTS.ticketCreated);
  });

  it("idempotent: redelivery of the same escalation yields exactly one ticket + one ticketCreated", async () => {
    const q = wired();
    const ref = randomUUID();
    // two distinct deliveries (different messageId) of the same escalation
    await q.publish(COMMANDS.createTicket, escalateMsg(TENANT_A, ref));
    await new Promise((r) => setTimeout(r, 200));
    await q.publish(COMMANDS.createTicket, escalateMsg(TENANT_A, ref));
    await new Promise((r) => setTimeout(r, 200));

    const rows = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) =>
        tx.select().from(tickets).where(
          and(eq(tickets.tenantId, TENANT_A), eq(tickets.source, SOURCE.assistant), eq(tickets.sourceRef, ref)),
        ),
      ),
    );
    expect(rows.length).toBe(1);

    const created = (await outboxFor(TENANT_A, rows[0]!.id)).filter((m) => m.topic === EVENTS.ticketCreated);
    expect(created.length).toBe(1);
  });

  it("tenant isolation: same externalRef in two tenants → two distinct tickets", async () => {
    const q = wired();
    const ref = randomUUID();
    await q.publish(COMMANDS.createTicket, escalateMsg(TENANT_A, ref));
    await q.publish(COMMANDS.createTicket, escalateMsg(TENANT_B, ref));
    await new Promise((r) => setTimeout(r, 250));
    const a = await findBySourceAsTenant(TENANT_A, SOURCE.assistant, ref);
    const b = await findBySourceAsTenant(TENANT_B, SOURCE.assistant, ref);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.id).not.toBe(b!.id);
  });
});
