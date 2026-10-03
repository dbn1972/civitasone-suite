/**
 * Regression: detectDuplicates passed "dedup-<ticketId>-<ticketId>" to markProcessed(), but
 * _inbox.processed.message_id is a uuid column, so the handler threw "invalid input syntax for type
 * uuid" on the first similar ticket and never created a single "related" link suggestion.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { tickets } from "../src/modules/tickets/schema.js";
import { outboxSchema } from "../src/shared/outbox.js";
import { registerTicketConsumers } from "../src/modules/tickets/consumer.js";
import { COMMANDS, SOURCE } from "../src/topics.js";
import { SYSTEM_ACTOR_ID } from "@civitasone/outbox";
import * as repo from "../src/modules/tickets/repo.js";

const { outboxMessages } = outboxSchema;
const TENANT = "aaaaaaaa-0000-4000-8000-00000000dd01";
const ACTOR = "00000000-aaaa-4000-8000-0000000000dd";
const SUBJECT = "Streetlight outside the municipal school gate has stopped working since Monday";

function wire<Q extends Queue>(q: Q): Q {
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}
async function cleanup() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(tickets).where(eq(tickets.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
}
const create = (ref: string) => ({
  messageId: randomUUID(), type: COMMANDS.createTicket, tenantId: TENANT, actorId: ACTOR,
  correlationId: randomUUID(), schemaVersion: "1.0" as const,
  payload: { subject: SUBJECT, description: SUBJECT, priority: "High", source: SOURCE.assistant, externalRef: ref },
});

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("detectDuplicates dedupe key", () => {
  it("creates the related-link command once per ticket pair, with no dead-letter, even if detection is re-run", async () => {
    const q = wire(new MemoryQueue());
    registerTicketConsumers(q);
    const refA = randomUUID();
    const refB = randomUUID();
    await q.publish(COMMANDS.createTicket, create(refA));
    await q.publish(COMMANDS.createTicket, create(refB));
    await q.drain();
    const a = await runWithTenant(TENANT, () => repo.findBySource(TENANT, SOURCE.assistant, refA));
    const b = await runWithTenant(TENANT, () => repo.findBySource(TENANT, SOURCE.assistant, refB));
    expect(a && b).toBeTruthy();

    const detect = () => q.publish(COMMANDS.detectDuplicates, {
      messageId: randomUUID(), type: COMMANDS.detectDuplicates, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0" as const,
      payload: { ticketId: a!.id, description: SUBJECT, tenantId: TENANT },
    });
    await detect();
    await q.drain();
    expect(q.dlq, JSON.stringify(q.dlq)).toHaveLength(0);
    const links = async () => (await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))))).filter((r) => r.topic === COMMANDS.linkTickets);
    expect(await links()).toHaveLength(1);

    await detect(); // a second detection pass for the same pair must not duplicate the suggestion
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    expect(await links()).toHaveLength(1);
  });
});

describe("system-published commands carry a uuid actor", () => {
  it("createTicket's fire-and-forget detectDuplicates command uses the uuid system actor, not the string 'system'", async () => {
    const q = wire(new MemoryQueue());
    const seen: string[] = [];
    q.subscribe(COMMANDS.detectDuplicates, async (m) => { seen.push(m.actorId); });
    registerTicketConsumers(q);
    // internal intake path: a full payload with a pre-assigned id (the assistant path returns early)
    await q.publish(COMMANDS.createTicket, {
      ...create(randomUUID()),
      payload: { id: randomUUID(), tenantId: TENANT, subject: SUBJECT, description: SUBJECT, priority: "High", status: "open" },
    });
    await q.drain();
    expect(q.dlq, JSON.stringify(q.dlq)).toHaveLength(0);
    expect(seen.length).toBeGreaterThan(0);
    for (const actor of seen) {
      expect(actor).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(actor).toBe(SYSTEM_ACTOR_ID);
    }
  });
});
