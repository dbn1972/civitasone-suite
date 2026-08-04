/**
 * notification.inbox.correlate consumer round-trip tests.
 *
 * Closes an orphan loop: correlation-routes.ts (INT-04) published
 * notification.inbox.correlate with NOTHING consuming it — the POST always
 * returned 202, but ticketId was never persisted to
 * notification.inbox_correlations, so the sibling GET on the same route file
 * could never find a row (see tests/inbox-correlation.test.ts's "returns 404
 * when no correlation exists" — that was actually the only possible outcome
 * for ANY conversationId, not just an unknown one).
 *
 * Mirrors tests/inbox-keyword-handoff.test.ts's deliver()/drain() harness.
 * Kept in its own file rather than extending inbox-correlation.test.ts so the
 * existing route-only assertions there stay untouched.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { inboxCorrelations } from "../src/modules/inbox/correlation-schema.js";
import { registerInboxConsumers } from "../src/modules/inbox/consumer.js";
import { COMMANDS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT_A = "aaaa0001-2222-4000-8000-000000000091";
const TENANT_B = "bbbb0001-2222-4000-8000-000000000092";
const ACTOR = "ccccaaaa-2222-4000-8000-0000000000cc";

function token(roles: string[], tid = TENANT_A): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-correlate" }, SECRET, 3600);
}
const bearer = (roles: string[], tid = TENANT_A) => ({ authorization: `Bearer ${token(roles, tid)}` });

const deliveredMessageIds = new Set<string>();

async function cleanup(): Promise<void> {
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await runWithTenant(tenantId, () => db.transaction(async (tx) => {
      await tx.delete(inboxCorrelations).where(eq(inboxCorrelations.tenantId, tenantId));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, tenantId));
    }));
  }
  // _inbox.processed is shared/non-tenant-scoped — only remove this file's
  // own message ids so parallel test files' idempotency markers survive.
  if (deliveredMessageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

async function deliver(topic: string, messageId: string, tenantId: string, payload: unknown): Promise<void> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerInboxConsumers(q);
  await q.start();
  await q.publish(topic, {
    messageId, type: topic, tenantId, actorId: ACTOR,
    correlationId: `corr-${messageId}`, schemaVersion: "1.0", payload,
  });
  await q.drain();
  await q.stop();
}

async function correlationRow(tenantId: string, conversationId: string) {
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const rows = await tx.select().from(inboxCorrelations)
      .where(eq(inboxCorrelations.conversationId, conversationId));
    return rows.find((r) => r.tenantId === tenantId) ?? null;
  }));
}

beforeAll(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("notification.inbox.correlate consumer", () => {
  it("persists the ticketId onto notification.inbox_correlations", async () => {
    const conversationId = randomUUID();
    const ticketId = randomUUID();
    const id = randomUUID();
    await deliver(COMMANDS.correlateInbox, id, TENANT_A, {
      id, tenantId: TENANT_A, conversationId, ticketId,
    });

    const row = await correlationRow(TENANT_A, conversationId);
    expect(row).not.toBeNull();
    expect(row!.ticketId).toBe(ticketId);
  });

  it("the GET route sees the persisted correlation (closes the full loop)", async () => {
    const conversationId = randomUUID();
    const ticketId = randomUUID();
    const id = randomUUID();
    await deliver(COMMANDS.correlateInbox, id, TENANT_A, {
      id, tenantId: TENANT_A, conversationId, ticketId,
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/notification/inbox/${conversationId}/correlation`,
      headers: bearer(["helpdesk_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.ticketId).toBe(ticketId);
  });

  it("idempotent: redelivering the same messageId does not error and keeps one row", async () => {
    const conversationId = randomUUID();
    const ticketId = randomUUID();
    const id = randomUUID();
    const payload = { id, tenantId: TENANT_A, conversationId, ticketId };
    await deliver(COMMANDS.correlateInbox, id, TENANT_A, payload);
    await deliver(COMMANDS.correlateInbox, id, TENANT_A, payload); // exact redelivery, same messageId

    const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) =>
      tx.select().from(inboxCorrelations).where(eq(inboxCorrelations.conversationId, conversationId)),
    ));
    expect(rows.length).toBe(1);
    expect(rows[0]!.ticketId).toBe(ticketId);
  });

  it("a second correlate for the same conversation (new messageId) updates the ticket, not a duplicate row", async () => {
    const conversationId = randomUUID();
    const firstTicket = randomUUID();
    const secondTicket = randomUUID();
    await deliver(COMMANDS.correlateInbox, randomUUID(), TENANT_A, {
      id: randomUUID(), tenantId: TENANT_A, conversationId, ticketId: firstTicket,
    });
    await deliver(COMMANDS.correlateInbox, randomUUID(), TENANT_A, {
      id: randomUUID(), tenantId: TENANT_A, conversationId, ticketId: secondTicket,
    });

    const rows = await runWithTenant(TENANT_A, () => db.transaction((tx) =>
      tx.select().from(inboxCorrelations).where(eq(inboxCorrelations.conversationId, conversationId)),
    ));
    expect(rows.length).toBe(1);
    expect(rows[0]!.ticketId).toBe(secondTicket);
  });

  it("RLS: tenant B cannot see tenant A's correlation for the same conversationId", async () => {
    const conversationId = randomUUID();
    const ticketId = randomUUID();
    await deliver(COMMANDS.correlateInbox, randomUUID(), TENANT_A, {
      id: randomUUID(), tenantId: TENANT_A, conversationId, ticketId,
    });

    const asB = await runWithTenant(TENANT_B, () => db.transaction((tx) =>
      tx.select().from(inboxCorrelations).where(eq(inboxCorrelations.conversationId, conversationId)),
    ));
    expect(asB.length).toBe(0);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/notification/inbox/${conversationId}/correlation`,
      headers: bearer(["helpdesk_admin"], TENANT_B),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});
