/**
 * BRD §9.4 — contact-activity projection round-trip tests (DB-backed).
 *
 * Drives the REAL consumer (registerContactCommunicationConsumer) against a
 * MemoryQueue + real Postgres (civitas_crm), then asserts the persisted
 * crm.contact_communications rows and the REAL Customer-360 counts. Covers:
 *   - happy path: notification.contact_activity.recorded -> projection row
 *   - idempotency (messageId): redelivering the same messageId writes one row
 *   - idempotency (dedupe_key): a re-emitted campaign send under a NEW messageId
 *     but the SAME campaignRecipientId does not double-count
 *   - Customer-360: contact 360 returns communications + campaignActivity with
 *     source:'crm' computed from the projection
 *   - RLS: tenant B never sees tenant A's projection rows
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { registerContactCommunicationConsumer } from "../src/modules/communications/contact-activity-consumer.js";

const TOPIC = "notification.contact_activity.recorded";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT_A = "dddddddd-0000-4000-8000-000000009401";
const TENANT_B = "dddddddd-0000-4000-8000-000000009402";
const ACTOR = "dddddddd-0000-4000-8000-0000000094aa";
const CONTACT_A = "aaaa9401-bbbb-4000-8000-000000009401";
const CONTACT_B = "aaaa9402-bbbb-4000-8000-000000009402";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

const queue = wireTenantAwareQueue(new MemoryQueue());
registerContactCommunicationConsumer(queue);

function tenantQuery(tenantId: string) {
  return {
    async select(query: string, params: unknown[] = []): Promise<any[]> {
      return sqlClient.begin(async (tx) => {
        await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return tx.unsafe(query, params);
      });
    },
  };
}

async function publish(payload: Record<string, unknown>, opts: { tenantId: string; messageId?: string }): Promise<void> {
  await queue.publish(TOPIC, {
    messageId: opts.messageId ?? randomUUID(),
    type: TOPIC,
    tenantId: opts.tenantId,
    actorId: ACTOR,
    correlationId: (payload.correlationId as string) ?? randomUUID(),
    schemaVersion: "1.0",
    payload,
  });
}

/** Publish and wait until the expected number of projection rows is visible. */
async function driveUntil(
  payload: Record<string, unknown>,
  opts: { tenantId: string; messageId?: string },
  ready: () => Promise<boolean>,
): Promise<void> {
  await publish(payload, opts);
  const deadline = Date.now() + 5000;
  for (;;) {
    if (await ready()) return;
    if (Date.now() > deadline) throw new Error(`driveUntil timed out`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function projRows(tenantId: string, subjectId: string): Promise<any[]> {
  return tenantQuery(tenantId).select(
    "select * from crm.contact_communications where subject_id = $1 order by occurred_at",
    [subjectId],
  );
}

async function seedContact(tenantId: string, contactId: string, name: string): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx`INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
             VALUES (${contactId}, ${tenantId}, ${name}, 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
             ON CONFLICT (id) DO NOTHING`;
  });
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT_A, TENANT_B]) {
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
      await tx`DELETE FROM crm.contact_communications WHERE tenant_id = ${t}`.catch(() => {});
      await tx`DELETE FROM crm.contacts WHERE tenant_id = ${t}`.catch(() => {});
    }).catch(() => {});
  }
}

function headers(tenantId: string, roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function get360(tenantId: string, id: string) {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: `/v1/crm/contacts/${id}/360`, headers: headers(tenantId) });
  await app.close();
  return res;
}

beforeAll(async () => {
  await cleanup();
  await seedContact(TENANT_A, CONTACT_A, "Nine-Four Buyer");
  await seedContact(TENANT_B, CONTACT_B, "Tenant B Buyer");
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("notification.contact_activity.recorded -> crm.contact_communications", () => {
  it("projects a delivered message onto the contact", { timeout: 10000 }, async () => {
    const messageId = `msg-${randomUUID()}`;
    await driveUntil(
      {
        externalReferenceId: CONTACT_A, subjectType: "contact", kind: "message_delivered",
        messageId, providerId: "twilio", status: "delivered", occurredAt: new Date().toISOString(),
        campaignId: null, campaignRecipientId: null, revenueMinor: null,
      },
      { tenantId: TENANT_A },
      async () => (await projRows(TENANT_A, CONTACT_A)).some((r) => r.message_id === messageId),
    );
    const rows = await projRows(TENANT_A, CONTACT_A);
    const row = rows.find((r) => r.message_id === messageId)!;
    expect(row.kind).toBe("message_delivered");
    expect(row.status).toBe("delivered");
    expect(row.provider_id).toBe("twilio");
    expect(row.dedupe_key).toBe(messageId);
  });

  it("is idempotent on messageId: redelivery writes exactly one row", { timeout: 10000 }, async () => {
    const messageId = `msg-${randomUUID()}`;
    const envId = randomUUID();
    const payload = {
      externalReferenceId: CONTACT_A, subjectType: "contact", kind: "message_failed",
      messageId, providerId: "smtp", status: "failed", occurredAt: new Date().toISOString(),
    };
    await driveUntil(payload, { tenantId: TENANT_A, messageId: envId },
      async () => (await projRows(TENANT_A, CONTACT_A)).some((r) => r.message_id === messageId));
    // Redeliver identical envelope messageId.
    await publish(payload, { tenantId: TENANT_A, messageId: envId });
    await new Promise((r) => setTimeout(r, 250));
    const rows = await tenantQuery(TENANT_A).select(
      "select count(*)::int as n from crm.contact_communications where message_id = $1", [messageId]);
    expect(rows[0]?.n).toBe(1);
  });

  it("dedupes a re-emitted campaign send by campaignRecipientId under a new messageId", { timeout: 10000 }, async () => {
    const recipientId = randomUUID();
    const campaignId = randomUUID();
    const base = {
      externalReferenceId: CONTACT_A, subjectType: "contact", kind: "campaign_response",
      campaignId, campaignRecipientId: recipientId, status: "responded", occurredAt: new Date().toISOString(),
    };
    await driveUntil({ ...base, messageId: "m-first" }, { tenantId: TENANT_A, messageId: randomUUID() },
      async () => (await tenantQuery(TENANT_A).select(
        "select 1 from crm.contact_communications where campaign_recipient_id = $1", [recipientId])).length > 0);
    // Same person-level send, fresh hub messageId + fresh envelope id -> must not double-count.
    await publish({ ...base, messageId: "m-second" }, { tenantId: TENANT_A, messageId: randomUUID() });
    await new Promise((r) => setTimeout(r, 250));
    const rows = await tenantQuery(TENANT_A).select(
      "select count(*)::int as n from crm.contact_communications where campaign_recipient_id = $1", [recipientId]);
    expect(rows[0]?.n).toBe(1);
  });

  it("Customer-360 returns REAL communications + campaignActivity (source:'crm')", { timeout: 15000 }, async () => {
    const subject = CONTACT_A;
    // A converted campaign response carrying revenue.
    const recipientId = randomUUID();
    await driveUntil({
      externalReferenceId: subject, subjectType: "contact", kind: "campaign_response",
      campaignId: randomUUID(), campaignRecipientId: recipientId, status: "converted",
      revenueMinor: "150000", occurredAt: new Date().toISOString(),
    }, { tenantId: TENANT_A }, async () => (await tenantQuery(TENANT_A).select(
      "select 1 from crm.contact_communications where campaign_recipient_id = $1", [recipientId])).length > 0);

    const res = await get360(TENANT_A, subject);
    expect(res.statusCode).toBe(200);
    const d = res.json().data;

    expect(d.communications.source).toBe("crm");
    // From tests above: >=1 delivered, >=1 failed message projected on CONTACT_A.
    expect(d.communications.delivered).toBeGreaterThanOrEqual(1);
    expect(d.communications.failed).toBeGreaterThanOrEqual(1);
    expect(d.communications.total).toBe(d.communications.delivered + d.communications.failed);

    expect(d.campaignActivity.source).toBe("crm");
    expect(d.campaignActivity.responses).toBeGreaterThanOrEqual(2);
    expect(d.campaignActivity.conversions).toBeGreaterThanOrEqual(1);
    // revenueMinor is a string paise sum; the converted response contributed 150000.
    expect(typeof d.campaignActivity.revenueMinor).toBe("string");
    expect(BigInt(d.campaignActivity.revenueMinor)).toBeGreaterThanOrEqual(150000n);
  });

  it("drops-and-acks a payload with a malformed typed field (no throw, no row, no retry)", { timeout: 10000 }, async () => {
    const subject = randomUUID();
    await seedContact(TENANT_A, subject, "Malformed Field Subject");

    // revenueMinor as a decimal string would fail `::bigint` inside the tx and
    // (pre-fix) rethrow as a fake transient error, burning the retry budget.
    await publish({
      externalReferenceId: subject, subjectType: "contact", kind: "campaign_response",
      campaignId: randomUUID(), campaignRecipientId: randomUUID(),
      status: "converted", revenueMinor: "12.50", occurredAt: new Date().toISOString(),
    }, { tenantId: TENANT_A });

    // A non-UUID campaignId would fail the uuid-column cast the same way.
    await publish({
      externalReferenceId: subject, subjectType: "contact", kind: "campaign_response",
      campaignId: "not-a-uuid", campaignRecipientId: randomUUID(),
      status: "responded", occurredAt: new Date().toISOString(),
    }, { tenantId: TENANT_A });

    // Give the queue ample time: were these rethrown, retries+backoff would still
    // be in flight and eventually DLQ — either way, no row must ever land.
    await new Promise((r) => setTimeout(r, 500));
    const rows = await projRows(TENANT_A, subject);
    expect(rows.length).toBe(0);

    // The consumer is not poisoned/stalled: a well-formed event still projects.
    const goodMsg = `msg-good-${randomUUID()}`;
    await driveUntil({
      externalReferenceId: subject, subjectType: "contact", kind: "message_delivered",
      messageId: goodMsg, status: "delivered", occurredAt: new Date().toISOString(),
    }, { tenantId: TENANT_A }, async () => (await projRows(TENANT_A, subject)).length > 0);
    expect((await projRows(TENANT_A, subject)).length).toBe(1);
  });

  it("real zeros (source:'crm') for a contact with no projected activity", { timeout: 10000 }, async () => {
    const empty = randomUUID();
    await seedContact(TENANT_A, empty, "No Activity");
    const d = (await get360(TENANT_A, empty)).json().data;
    expect(d.communications).toEqual({ total: 0, delivered: 0, failed: 0, source: "crm" });
    expect(d.campaignActivity).toEqual({ responses: 0, conversions: 0, revenueMinor: "0", source: "crm" });
  });

  it("RLS: tenant B never sees tenant A's projection", { timeout: 10000 }, async () => {
    // Project an activity for tenant B's own contact.
    const messageId = `msg-b-${randomUUID()}`;
    await driveUntil({
      externalReferenceId: CONTACT_B, subjectType: "contact", kind: "message_delivered",
      messageId, status: "delivered", occurredAt: new Date().toISOString(),
    }, { tenantId: TENANT_B }, async () => (await projRows(TENANT_B, CONTACT_B)).length > 0);

    // Tenant B cannot see tenant A's rows for CONTACT_A.
    const leak = await tenantQuery(TENANT_B).select(
      "select count(*)::int as n from crm.contact_communications where subject_id = $1", [CONTACT_A]);
    expect(leak[0]?.n).toBe(0);
    // Tenant A cannot see tenant B's rows for CONTACT_B.
    const leak2 = await tenantQuery(TENANT_A).select(
      "select count(*)::int as n from crm.contact_communications where subject_id = $1", [CONTACT_B]);
    expect(leak2[0]?.n).toBe(0);
  });
});
