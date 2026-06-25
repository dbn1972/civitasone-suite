/**
 * P1 closure tests — opt-out enforcement, durable retry sweep, recipient-scoped
 * inbox isolation, PII masking, fail-closed adapters, idempotent delivery.
 *
 * DB-backed tests run against the live Postgres pointed at by DATABASE_URL
 * (same as routes.test.ts). They seed + clean their own rows under a dedicated
 * tenant so they don't collide with other suites.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import {
  resolvePreferredChannel,
  resolveChannelWithDefault,
  CHANNEL_NONE,
} from "../src/modules/deliveries/channel.js";
import * as repo from "../src/modules/deliveries/repo.js";
import { sweepDueRetries } from "../src/modules/deliveries/sweeper.js";
import { maskRecipient } from "../src/adapters/mask.js";
import { smsAdapter, whatsAppAdapter, pushAdapter } from "../src/adapters/index.js";
import type { PrefView } from "../src/modules/templates/domain.js";

const TENANT = "dddddddd-1111-4000-8000-0000000000aa";
const TEMPLATE = "dddddddd-2222-4000-8000-0000000000bb";

function pref(over: Partial<PrefView>): PrefView {
  return {
    id: randomUUID(), tenantId: TENANT, userId: randomUUID(),
    eventType: "alert", inApp: false, email: false, push: false, version: 1, ...over,
  };
}

async function insertRow(row: {
  id: string; recipient: string; recipientId: string | null; channel: string;
  status: string; retryCount?: number; nextRetryAt?: Date | null;
}): Promise<void> {
  const nextRetryAt = row.nextRetryAt ? row.nextRetryAt.toISOString() : null;
  await sqlClient`
    INSERT INTO deliveries.deliveries
      (id, tenant_id, template_id, recipient, recipient_id, channel, status, retry_count, next_retry_at, created_by, updated_by, version)
    VALUES
      (${row.id}, ${TENANT}, ${TEMPLATE}, ${row.recipient}, ${row.recipientId},
       ${row.channel}, ${row.status}, ${row.retryCount ?? 0}, ${nextRetryAt}::timestamptz,
       ${TENANT}, ${TENANT}, 1)`;
}

async function cleanup(): Promise<void> {
  await sqlClient`DELETE FROM deliveries.deliveries WHERE tenant_id = ${TENANT}`;
}

afterAll(async () => { await sqlClient.end(); });

describe("P1-1 opt-out enforcement (unit)", () => {
  it("fully opted-out pref → CHANNEL_NONE, optedOut=true, no email forced", () => {
    const prefs = [pref({ eventType: "alert", inApp: false, email: false, push: false })];
    const r = resolvePreferredChannel(prefs, "alert");
    expect(r.optedOut).toBe(true);
    expect(r.preferred).toBe(CHANNEL_NONE);
    expect(r.fallbacks).toEqual([]);
  });

  it("no pref expressed → defaults to email (not opted out)", () => {
    const r = resolvePreferredChannel([], "alert");
    expect(r.optedOut).toBe(false);
    expect(r.preferred).toBe("email");
  });

  it("partial pref (email on) → email, not opted out", () => {
    const prefs = [pref({ eventType: "alert", email: true })];
    const r = resolvePreferredChannel(prefs, "alert");
    expect(r.optedOut).toBe(false);
    expect(r.preferred).toBe("email");
  });

  it("resolveChannelWithDefault returns CHANNEL_NONE for opted-out recipient", async () => {
    const prefs = [pref({ eventType: "alert", inApp: false, email: false, push: false })];
    const ch = await resolveChannelWithDefault(TENANT, prefs, "alert");
    expect(ch).toBe(CHANNEL_NONE);
  });
});

describe("P1-1 opt-out enforcement (DB + real consumer end-to-end)", () => {
  beforeEach(cleanup);
  afterEach(async () => {
    await cleanup();
    await sqlClient`DELETE FROM templates.prefs WHERE tenant_id = ${TENANT}`;
    await sqlClient`DELETE FROM templates.templates WHERE tenant_id = ${TENANT}`;
  });

  it("opted-out recipient → consumer records status=skipped channel=none and sends nothing (even with an email template)", async () => {
    const { registerDeliveryConsumers } = await import("../src/modules/deliveries/consumer.js");
    const recipientId = randomUUID();
    // An email template — proves the template's default channel does NOT override opt-out.
    await sqlClient`INSERT INTO templates.templates (id, tenant_id, channel, name, subject, body, created_by, updated_by)
      VALUES (${TEMPLATE}, ${TENANT}, 'email', 'OptOut', 'Hi', 'Hello', ${TENANT}, ${TENANT})`;
    await sqlClient`INSERT INTO templates.prefs (id, tenant_id, user_id, event_type, in_app, email, push, created_by, updated_by)
      VALUES (${randomUUID()}, ${TENANT}, ${recipientId}, 'optout.evt', false, false, false, ${TENANT}, ${TENANT})`;

    const q = new MemoryQueue();
    registerDeliveryConsumers(q);
    await q.start();
    await q.publish("notification.send", {
      messageId: randomUUID(), type: "notification.send", tenantId: TENANT, actorId: TENANT,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { templateId: TEMPLATE, recipient: "victim@d.gov.in", recipientId, eventType: "optout.evt" },
    });
    await new Promise((r) => setTimeout(r, 250));

    const rows = await sqlClient`SELECT status, channel FROM deliveries.deliveries WHERE recipient_id = ${recipientId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("skipped");
    expect(rows[0]?.channel).toBe("none");
  });
});

describe("P1-2 durable retry sweep (DB — survives restart)", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("a due queued retry is found, claimed, and republished; restart-equivalent re-sweep is a no-op", async () => {
    const id = randomUUID();
    const past = new Date(Date.now() - 60_000); // 1 minute ago → due
    await insertRow({ id, recipient: "officer@dept.gov.in", recipientId: randomUUID(), channel: "email", status: "queued", retryCount: 1, nextRetryAt: past });

    // Restart-equivalent: a brand-new queue + sweeper (no in-process timer carried
    // over) still finds the due row purely from the DB.
    const q = new MemoryQueue();
    const published: string[] = [];
    q.subscribe("notification.send", async (m) => { published.push((m.payload as { deliveryId: string }).deliveryId); });
    await q.start();

    const swept = await sweepDueRetries(q);
    expect(swept).toBe(1);
    await new Promise((r) => setTimeout(r, 80));
    expect(published).toContain(id);

    // Row was claimed out of `queued` → second sweep does nothing (no double-send).
    const rows = await sqlClient`SELECT status FROM deliveries.deliveries WHERE id = ${id}`;
    expect(rows[0]?.status).not.toBe("queued");
    const swept2 = await sweepDueRetries(q);
    expect(swept2).toBe(0);
  });

  it("a not-yet-due queued retry is left alone", async () => {
    const id = randomUUID();
    const future = new Date(Date.now() + 3_600_000); // 1h ahead
    await insertRow({ id, recipient: "a@b.gov.in", recipientId: randomUUID(), channel: "email", status: "queued", retryCount: 1, nextRetryAt: future });
    const q = new MemoryQueue();
    expect(await sweepDueRetries(q)).toBe(0);
    const rows = await sqlClient`SELECT status FROM deliveries.deliveries WHERE id = ${id}`;
    expect(rows[0]?.status).toBe("queued");
  });
});

describe("P1-3 recipient-scoped inbox isolation (DB)", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("findByRecipient returns only rows addressed TO that recipient", async () => {
    const alice = randomUUID();
    const bob = randomUUID();
    await insertRow({ id: randomUUID(), recipient: "alice@d.gov.in", recipientId: alice, channel: "email", status: "delivered" });
    await insertRow({ id: randomUUID(), recipient: "alice@d.gov.in", recipientId: alice, channel: "email", status: "delivered" });
    await insertRow({ id: randomUUID(), recipient: "bob@d.gov.in", recipientId: bob, channel: "email", status: "delivered" });

    const aliceInbox = await repo.findByRecipient(TENANT, alice);
    expect(aliceInbox).toHaveLength(2);
    expect(aliceInbox.every((r) => r.recipientId === alice)).toBe(true);

    const bobInbox = await repo.findByRecipient(TENANT, bob);
    expect(bobInbox).toHaveLength(1);
    expect(bobInbox[0]?.recipientId).toBe(bob);
  });

  it("tenant isolation: a recipient id from another tenant returns nothing", async () => {
    const alice = randomUUID();
    await insertRow({ id: randomUUID(), recipient: "alice@d.gov.in", recipientId: alice, channel: "email", status: "delivered" });
    const otherTenantView = await repo.findByRecipient("eeeeeeee-9999-4000-8000-0000000000ff", alice);
    expect(otherTenantView).toEqual([]);
  });
});

describe("P1-4 PII masking (unit)", () => {
  it("masks email local part and domain", () => {
    const m = maskRecipient("officer.kumar@department.gov.in");
    expect(m).not.toContain("officer.kumar");
    expect(m).not.toContain("department");
    expect(m).toMatch(/^o\*\*\*@\*\*\*\.in$/);
  });

  it("masks phone keeping only last 2 digits", () => {
    const m = maskRecipient("+919876543210");
    expect(m).toBe("***10");
    expect(m).not.toContain("98765");
  });

  it("masks opaque identifiers and handles null", () => {
    // A non-numeric opaque id reveals at most a short prefix.
    const m = maskRecipient("abcdefghateam");
    expect(m).toBe("abcd***");
    expect(maskRecipient(null)).toBe("(none)");
  });
});

describe("P1-5 fail-closed adapters (unit)", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it("sms stub fails closed (never silently ok)", async () => {
    process.env.NOTIFICATION_SMS_DRIVER = "stub";
    const r = await smsAdapter.send({ recipient: "+919999999999", body: "hi" });
    expect(r.ok).toBe(false);
  });

  it("sms twilio without creds fails closed", async () => {
    process.env.NOTIFICATION_SMS_DRIVER = "twilio";
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM;
    const r = await smsAdapter.send({ recipient: "+919999999999", body: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("not configured");
  });

  it("whatsapp meta without creds fails closed", async () => {
    process.env.NOTIFICATION_WHATSAPP_DRIVER = "meta";
    delete process.env.META_WHATSAPP_TOKEN;
    delete process.env.META_WHATSAPP_PHONE_ID;
    const r = await whatsAppAdapter.send({ recipient: "+919999999999", body: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("not configured");
  });

  it("push firebase without server key fails closed", async () => {
    process.env.NOTIFICATION_PUSH_DRIVER = "firebase";
    delete process.env.FIREBASE_SERVER_KEY;
    const r = await pushAdapter.send({ recipient: "device-token", body: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("not configured");
  });
});

describe("P1-6 idempotent claim (DB)", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("claimDueRetry is won exactly once for a given version (no double republish)", async () => {
    const id = randomUUID();
    const past = new Date(Date.now() - 60_000);
    await insertRow({ id, recipient: "x@d.gov.in", recipientId: randomUUID(), channel: "email", status: "queued", retryCount: 1, nextRetryAt: past });

    const [a, b] = await Promise.all([
      repo.claimDueRetry(id, 1, new Date()),
      repo.claimDueRetry(id, 1, new Date()),
    ]);
    // Exactly one caller wins the claim — the other sees the row already moved.
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});
