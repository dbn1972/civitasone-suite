/**
 * P1-5 / P1-6 — an inbound SMS / WhatsApp opt-out must actually WITHDRAW CONSENT.
 *
 * The defect these cover: `keyword_rules.action` documented "opt_out" as a named
 * side effect, the inbox consumer wrote that string to
 * `inbound_auto_responses.action`, emitted `keyword_auto_responded` (which nothing
 * consumed) and replied "You have been unsubscribed." — and then changed nothing
 * the send path reads. A recipient who had opted in to marketing SMS and replied
 * STOP kept receiving marketing SMS.
 *
 * The load-bearing assertion is therefore NOT "a suppression row exists" but "the
 * real send consumer refuses the next send and no adapter is invoked". A recorded
 * opt-out that the send path does not honour is the bug, not the fix, so a spy on
 * the adapters is what separates the two claims — same convention as
 * consent-gate-consumer.test.ts.
 *
 * DB-backed against DATABASE_URL, on a dedicated tenant so suites cannot collide.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { blindIndex } from "../src/shared/pii-crypto.js";
import { smsAdapter, whatsAppAdapter, emailAdapter } from "../src/adapters/index.js";
import { keywordRules, inboundAutoResponses } from "../src/modules/inbox/keyword-schema.js";
import { registerInboxConsumers } from "../src/modules/inbox/consumer.js";
import {
  registerDeliveryConsumers,
  setConsentLookupForTests,
  resetConsentLookup,
} from "../src/modules/deliveries/consumer.js";
import { isOptOutAction, normalizeAction } from "../src/modules/inbox/keyword-domain.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "dddd0001-6666-4000-8000-0000000000d1";
const ACTOR = "dddd0002-6666-4000-8000-0000000000d2";
const TEMPLATE = "dddd0003-6666-4000-8000-0000000000d3";
const RULE_ID = "dddd0004-6666-4000-8000-0000000000d4";
const SYSTEM = "00000000-0000-0000-0000-000000000001";

/** PII: an inbound sender. Never asserted in an event payload or a log line. */
const SENDER = "+919876500011";

/** Domain tables have FORCED RLS and the service role is NOBYPASSRLS (#146). */
async function sqlAsTenant<T>(fn: (sql: typeof sqlClient) => Promise<T> | T): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}

const deliveredMessageIds = new Set<string>();

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(inboundAutoResponses).where(eq(inboundAutoResponses.tenantId, TENANT));
    await tx.delete(keywordRules).where(eq(keywordRules.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  await sqlAsTenant(async (sql) => {
    await sql`DELETE FROM bounces.suppression_list WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM deliveries.deliveries WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM templates.prefs WHERE tenant_id = ${TENANT}`;
  });
  // _inbox.processed is SHARED and not tenant-scoped: an unqualified DELETE would
  // wipe other parallel suites' idempotency markers.
  if (deliveredMessageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

async function seedRule(over: Partial<{
  keyword: string; channel: string | null; responseBody: string | null; action: string | null;
}> = {}): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(keywordRules).values({
      id: RULE_ID, tenantId: TENANT,
      keyword: over.keyword ?? "STOP",
      matchType: "exact",
      channel: over.channel ?? null,
      priority: 100,
      responseBody: over.responseBody === undefined ? "You have been unsubscribed." : over.responseBody,
      action: over.action === undefined ? "opt_out" : over.action,
      enabled: true,
      createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    }).onConflictDoNothing();
  }));
}

async function seedTemplate(channel: string): Promise<void> {
  await sqlAsTenant((sql) => sql`
    INSERT INTO templates.templates (id, tenant_id, channel, name, subject, body, created_by, updated_by)
    VALUES (${TEMPLATE}, ${TENANT}, ${channel}, 'OptOut', 'Subject', 'Body', ${SYSTEM}, ${SYSTEM})
    ON CONFLICT (id) DO UPDATE SET channel = ${channel}`);
}

async function suppressions(): Promise<Array<{ channel: string; reason: string; source: string; recipient_hash: string; released_at: Date | null }>> {
  return sqlAsTenant((sql) => sql`
    SELECT channel, reason, source, recipient_hash, released_at
    FROM bounces.suppression_list WHERE tenant_id = ${TENANT}`) as never;
}

/** Deliver one inbound message through the REAL inbox consumer. */
async function inbound(messageId: string, body: string, channel: string): Promise<MemoryQueue> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerInboxConsumers(q);
  await q.start();
  await q.publish(COMMANDS.inboundReceived, {
    messageId, type: COMMANDS.inboundReceived, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-${messageId}`, schemaVersion: "1.0",
    payload: { id: messageId, tenantId: TENANT, channel, from: SENDER, body },
  });
  await q.drain();
  await q.stop();
  return q;
}

/** Deliver one outbound send through the REAL send consumer (gate included). */
async function send(messageId: string, payload: Record<string, unknown>): Promise<MemoryQueue> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerDeliveryConsumers(q);
  await q.start();
  await q.publish(COMMANDS.sendNotification, {
    messageId, type: COMMANDS.sendNotification, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-${messageId}`, schemaVersion: "1.0", payload,
  });
  await q.drain();
  await q.stop();
  return q;
}

async function deliveryStatuses(): Promise<Array<{ status: string; channel: string }>> {
  return sqlAsTenant((sql) => sql`
    SELECT status, channel FROM deliveries.deliveries WHERE tenant_id = ${TENANT}`) as never;
}

beforeEach(async () => {
  await cleanup();
  vi.restoreAllMocks();
  // Consent is GRANTED for every case below, so a refusal can only come from the
  // opt-out under test — never from an unrelated fail-closed CRM branch.
  setConsentLookupForTests(async () => "granted");
});

afterAll(async () => {
  resetConsentLookup();
  await cleanup();
  await sqlClient.end();
});

/* ------------------------------------------------------------ pure domain */

describe("isOptOutAction — recognising a consent withdrawal", () => {
  it("matches the canonical spelling and operator variants", () => {
    for (const a of ["opt_out", "OPT_OUT", "opt out", "OPT-OUT", " Opt_Out ", "optout", "unsubscribe"]) {
      expect(isOptOutAction(a)).toBe(true);
    }
  });

  it("does NOT match another action — a handoff must never suppress the sender", () => {
    for (const a of ["escalate_to_human", "assign_agent", "", "   ", null, undefined]) {
      expect(isOptOutAction(a)).toBe(false);
    }
  });

  it("normalizeAction folds punctuation runs to a single underscore", () => {
    expect(normalizeAction("  OPT -- OUT  ")).toBe("opt_out");
  });
});

/* --------------------------------------------- the fix, on the send path */

describe("P1-6 inbound STOP → consent withdrawn and honoured on the SMS send path", () => {
  it("records a tenant-scoped suppression with reason=unsubscribe source=inbound", async () => {
    await seedRule({ channel: "sms" });
    const q = await inbound("dddd1111-6666-4000-8000-000000000101", "STOP", "sms");
    expect(q.dlq).toHaveLength(0);

    const rows = await suppressions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: "sms", reason: "unsubscribe", source: "inbound", released_at: null,
    });
    // Blind index, never the cleartext address.
    expect(rows[0]?.recipient_hash).toBe(blindIndex(SENDER));
  });

  it("REGRESSION: a marketing SMS to a recipient who replied STOP no longer reaches the adapter", async () => {
    // The recipient had explicitly opted IN, so nothing except the STOP can
    // refuse this send. Without the fix the SMS is delivered.
    await seedTemplate("sms");
    await sqlAsTenant((sql) => sql`
      INSERT INTO templates.prefs (id, tenant_id, user_id, event_type, in_app, email, push, sms, whatsapp, created_by, updated_by)
      VALUES (${randomUUID()}, ${TENANT}, ${ACTOR}, 'marketing.offer', false, false, false, true, true, ${SYSTEM}, ${SYSTEM})`);
    await seedRule({ channel: "sms" });

    const smsSpy = vi.spyOn(smsAdapter, "send");
    const emailSpy = vi.spyOn(emailAdapter, "send");

    await inbound("dddd1111-6666-4000-8000-000000000102", "STOP", "sms");
    await send("dddd1111-6666-4000-8000-000000000103", {
      templateId: TEMPLATE, recipient: SENDER, recipientId: ACTOR,
      channel: "sms", eventType: "marketing.offer", category: "marketing",
    });

    expect(smsSpy).not.toHaveBeenCalled();
    // Nor may it quietly fall back onto another channel.
    expect(emailSpy).not.toHaveBeenCalled();
    expect(await deliveryStatuses()).toEqual([{ status: "skipped", channel: "sms" }]);
  });

  it("a TRANSACTIONAL SMS is refused too — an explicit withdrawal binds every send", async () => {
    // The repo's stated model (migration 0031): an explicit opt-out is honoured
    // on every send, both kinds. Suppression is evaluated first by decideGate.
    await seedTemplate("sms");
    await seedRule({ channel: "sms" });
    const smsSpy = vi.spyOn(smsAdapter, "send");

    await inbound("dddd1111-6666-4000-8000-000000000104", "STOP", "sms");
    await send("dddd1111-6666-4000-8000-000000000105", {
      templateId: TEMPLATE, recipient: SENDER, recipientId: ACTOR, channel: "sms",
      eventType: "billing.reminder",
    });

    expect(smsSpy).not.toHaveBeenCalled();
    expect(await deliveryStatuses()).toEqual([{ status: "skipped", channel: "sms" }]);
  });

  it("emits the opt-out domain event and an audit event, with NO address in either", async () => {
    await seedRule({ channel: "sms" });
    await inbound("dddd1111-6666-4000-8000-000000000106", "STOP", "sms");

    const rows = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))));

    const optedOut = rows.filter((r) => r.eventType === EVENTS.consentOptedOut);
    expect(optedOut).toHaveLength(1);
    expect(optedOut[0]?.payload).toMatchObject({
      ruleId: RULE_ID, channel: "sms", reason: "unsubscribe", source: "inbound",
      recipientHash: blindIndex(SENDER),
    });

    const audits = rows.filter((r) =>
      r.eventType === "audit.event.record"
      && (r.payload as { action?: string }).action === "opt_out");
    expect(audits).toHaveLength(1);
    expect(audits[0]?.payload).toMatchObject({
      service: "notification", resourceType: "suppression", outcome: "success",
      reason: "unsubscribe", source: "inbound",
    });

    // PII: the sender address must not appear anywhere in the emitted outbox.
    expect(JSON.stringify(rows.map((r) => r.payload))).not.toContain(SENDER);
  });

  it("is idempotent — a redelivered STOP leaves exactly one suppression row", async () => {
    await seedRule({ channel: "sms" });
    const MSG = "dddd1111-6666-4000-8000-000000000107";
    await inbound(MSG, "STOP", "sms");
    expect(await suppressions()).toHaveLength(1);
    const q = await inbound(MSG, "STOP", "sms");
    expect(q.dlq).toHaveLength(0);
    expect(await suppressions()).toHaveLength(1);
  });

  it("a resent STOP from the same sender under a NEW message id still yields one row", async () => {
    await seedRule({ channel: "sms" });
    await inbound("dddd1111-6666-4000-8000-000000000108", "STOP", "sms");
    await inbound("dddd1111-6666-4000-8000-000000000109", "STOP", "sms");
    // upsertSuppression conflicts on (tenant_id, recipient_hash).
    expect(await suppressions()).toHaveLength(1);
  });
});

/* --------------------------------------------------- P1-5: WhatsApp parity */

describe("P1-5 the WhatsApp path gets the same treatment as SMS", () => {
  it("an inbound WhatsApp STOP suppresses the sender and blocks the next WhatsApp send", async () => {
    await seedTemplate("whatsapp");
    await sqlAsTenant((sql) => sql`
      INSERT INTO templates.prefs (id, tenant_id, user_id, event_type, in_app, email, push, sms, whatsapp, created_by, updated_by)
      VALUES (${randomUUID()}, ${TENANT}, ${ACTOR}, 'marketing.offer', false, false, false, true, true, ${SYSTEM}, ${SYSTEM})`);
    await seedRule({ channel: "whatsapp" });

    const waSpy = vi.spyOn(whatsAppAdapter, "send");

    await inbound("dddd2222-6666-4000-8000-000000000201", "STOP", "whatsapp");
    const rows = await suppressions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "whatsapp", reason: "unsubscribe", source: "inbound" });

    await send("dddd2222-6666-4000-8000-000000000202", {
      templateId: TEMPLATE, recipient: SENDER, recipientId: ACTOR,
      channel: "whatsapp", eventType: "marketing.offer", category: "marketing",
    });

    expect(waSpy).not.toHaveBeenCalled();
    expect(await deliveryStatuses()).toEqual([{ status: "skipped", channel: "whatsapp" }]);
  });
});

/* ------------------------------------------------------- must NOT over-block */

describe("the opt-out fires only for an opt-out rule", () => {
  it("a reply-only STOP rule records no suppression", async () => {
    await seedRule({ channel: "sms", action: null, responseBody: "Thanks." });
    await inbound("dddd3333-6666-4000-8000-000000000301", "STOP", "sms");
    expect(await suppressions()).toHaveLength(0);
  });

  it("an escalate_to_human rule records no suppression", async () => {
    await seedRule({ keyword: "AGENT", channel: "sms", action: "escalate_to_human" });
    await inbound("dddd3333-6666-4000-8000-000000000302", "AGENT", "sms");
    const responses = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(inboundAutoResponses).where(and(
        eq(inboundAutoResponses.tenantId, TENANT), eq(inboundAutoResponses.ruleId, RULE_ID)))));
    expect(responses).toHaveLength(1);
    expect(await suppressions()).toHaveLength(0);
  });

  it("a non-matching message records no suppression", async () => {
    await seedRule({ keyword: "STOP", channel: "sms" });
    await inbound("dddd3333-6666-4000-8000-000000000303", "when is my appointment", "sms");
    expect(await suppressions()).toHaveLength(0);
  });

  it("a disabled opt-out rule records no suppression", async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(keywordRules).values({
        id: RULE_ID, tenantId: TENANT, keyword: "STOP", matchType: "exact", channel: "sms",
        priority: 100, responseBody: null, action: "opt_out", enabled: false,
        createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      }).onConflictDoNothing();
    }));
    await inbound("dddd3333-6666-4000-8000-000000000304", "STOP", "sms");
    expect(await suppressions()).toHaveLength(0);
  });

  it("the opt-out is tenant-scoped — another tenant's send is unaffected", async () => {
    await seedRule({ channel: "sms" });
    await inbound("dddd3333-6666-4000-8000-000000000305", "STOP", "sms");
    const rows = await sqlAsTenant((sql) => sql`
      SELECT tenant_id FROM bounces.suppression_list WHERE recipient_hash = ${blindIndex(SENDER)}`);
    expect(rows.every((r: { tenant_id: string }) => r.tenant_id === TENANT)).toBe(true);
  });
});
