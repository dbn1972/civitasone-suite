/**
 * R1 — outbound consent gate, end-to-end through the REAL send consumer.
 *
 * These are the regression tests for the STOP-SHIP defect: `suppressionList`
 * and `dndWindows` were written but never read on the send path, and CRM
 * `marketing_consent` was never consulted at all, so every one of the cases
 * below used to reach a channel adapter.
 *
 * Adapter invocation is asserted directly (spy on `emailAdapter.send`) rather
 * than inferred from the delivery status: "recorded as skipped" and "no message
 * left the process" are different claims and only the second one is the fix.
 *
 * DB-backed, against the Postgres in DATABASE_URL — same convention as
 * p1-gaps.test.ts, with a dedicated tenant so suites cannot collide.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { encryptPii, blindIndex } from "../src/shared/pii-crypto.js";
import { emailAdapter, smsAdapter } from "../src/adapters/index.js";
import {
  registerDeliveryConsumers,
  setConsentLookupForTests,
  resetConsentLookup,
} from "../src/modules/deliveries/consumer.js";
import { registerBulkConsumers } from "../src/modules/bulk/consumer.js";

const TENANT = "cccccccc-7777-4000-8000-0000000000c1";
const TEMPLATE = "cccccccc-7777-4000-8000-0000000000c2";
const SYSTEM = "00000000-0000-0000-0000-000000000001";

/**
 * Domain tables have FORCED row-level security and the service role is
 * NOBYPASSRLS (#146), so direct seeding/inspection must set the app.tenant_id
 * GUC. Transaction-LOCAL, on a reserved connection.
 */
async function sqlAsTenant<T>(fn: (sql: typeof sqlClient) => Promise<T> | T): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}

async function seedTemplate(channel = "email"): Promise<void> {
  await sqlAsTenant((sql) => sql`
    INSERT INTO templates.templates (id, tenant_id, channel, name, subject, body, created_by, updated_by)
    VALUES (${TEMPLATE}, ${TENANT}, ${channel}, 'Gate', 'Subject', 'Body', ${SYSTEM}, ${SYSTEM})
    ON CONFLICT (id) DO UPDATE SET channel = ${channel}`);
}

async function suppress(recipient: string): Promise<void> {
  await sqlAsTenant((sql) => sql`
    INSERT INTO bounces.suppression_list
      (id, tenant_id, recipient, recipient_hash, channel, reason, source, created_by, updated_by)
    VALUES (${randomUUID()}, ${TENANT}, ${encryptPii(recipient)}, ${blindIndex(recipient)},
            'email', 'hard_bounce', 'bounce', ${SYSTEM}, ${SYSTEM})`);
}

/**
 * A DND window that is active right now, derived from the clock rather than
 * hardcoded, so the test does not depend on when CI happens to run. All seven
 * days are enabled so the UTC weekday never matters.
 */
async function seedActiveDndWindow(userId: string): Promise<void> {
  const now = Date.now();
  const hhmm = (t: number): string => new Date(t).toISOString().slice(11, 16);
  await sqlAsTenant((sql) => sql`
    INSERT INTO dnd.dnd_windows
      (id, tenant_id, user_id, start_time, end_time, timezone, days, enabled, created_by, updated_by)
    VALUES (${randomUUID()}, ${TENANT}, ${userId}, ${hhmm(now - 3_600_000)}, ${hhmm(now + 3_600_000)},
            'UTC', ${sql.json(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])}, true, ${SYSTEM}, ${SYSTEM})`);
}

/**
 * Seed one pref row. `sms`/`whatsapp` are tri-state (migration 0031) and default
 * to NULL here — "no choice recorded", which is what a real recipient who has
 * never opened the preferences screen looks like. Pass `false` explicitly to
 * record an opt-out.
 */
async function seedPref(userId: string, eventType: string, channels: {
  inApp?: boolean; email?: boolean; push?: boolean;
  sms?: boolean | null; whatsapp?: boolean | null;
}): Promise<void> {
  await sqlAsTenant((sql) => sql`
    INSERT INTO templates.prefs (id, tenant_id, user_id, event_type, in_app, email, push, sms, whatsapp, created_by, updated_by)
    VALUES (${randomUUID()}, ${TENANT}, ${userId}, ${eventType},
            ${channels.inApp ?? false}, ${channels.email ?? false}, ${channels.push ?? false},
            ${channels.sms ?? null}, ${channels.whatsapp ?? null}, ${SYSTEM}, ${SYSTEM})`);
}

type DeliveryRow = { status: string; channel: string; next_retry_at: string | null };

async function deliveriesFor(recipientId: string): Promise<DeliveryRow[]> {
  return sqlAsTenant((sql) => sql`
    SELECT status, channel, next_retry_at FROM deliveries.deliveries
    WHERE tenant_id = ${TENANT} AND recipient_id = ${recipientId}`) as unknown as Promise<DeliveryRow[]>;
}

async function cleanup(): Promise<void> {
  await sqlAsTenant(async (sql) => {
    await sql`DELETE FROM deliveries.deliveries WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM bounces.suppression_list WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM dnd.dnd_windows WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM dnd.held_notifications WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM templates.prefs WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM templates.templates WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM bulk.campaign_recipients WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM bulk.campaigns WHERE tenant_id = ${TENANT}`;
  });
  // The outbox relay table carries no RLS (migration 0028), so it is cleaned
  // outside the tenant GUC transaction.
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
}

/** Publish one send command through the real consumer and wait for it to settle. */
async function send(payload: Record<string, unknown>): Promise<void> {
  const q = new MemoryQueue();
  registerDeliveryConsumers(q);
  await q.start();
  await q.publish("notification.send", {
    messageId: randomUUID(), type: "notification.send", tenantId: TENANT, actorId: SYSTEM,
    correlationId: randomUUID(), schemaVersion: "1.0", payload,
  });
  await new Promise((r) => setTimeout(r, 400));
}

let sendSpy: ReturnType<typeof vi.spyOn>;
let smsSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  await cleanup();
  await seedTemplate();
  sendSpy = vi.spyOn(emailAdapter, "send");
  smsSpy = vi.spyOn(smsAdapter, "send");
});

afterEach(async () => {
  sendSpy.mockRestore();
  smsSpy.mockRestore();
  resetConsentLookup();
  await cleanup();
});

afterAll(async () => { await sqlClient.end(); });

describe("R1 gate (consumer) — suppression list is enforced on the send path", () => {
  it("a suppressed recipient is skipped and NO adapter is invoked", async () => {
    const recipientId = randomUUID();
    const recipient = "bounced@dept.gov.in";
    await suppress(recipient);

    await send({ templateId: TEMPLATE, recipient, recipientId, eventType: "gate.suppressed" });

    const rows = await deliveriesFor(recipientId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("skipped");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("a RELEASED suppression no longer blocks the send (proves the check reads released_at)", async () => {
    const recipientId = randomUUID();
    const recipient = "released@dept.gov.in";
    await suppress(recipient);
    await sqlAsTenant((sql) => sql`
      UPDATE bounces.suppression_list SET released_at = now()
      WHERE tenant_id = ${TENANT} AND recipient_hash = ${blindIndex(recipient)}`);

    await send({ templateId: TEMPLATE, recipient, recipientId, eventType: "gate.released" });

    const rows = await deliveriesFor(recipientId);
    expect(rows[0]?.status).toBe("delivered");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("a suppression belonging to ANOTHER tenant does not block this tenant's send", async () => {
    const recipientId = randomUUID();
    const recipient = "shared@dept.gov.in";
    const otherTenant = "cccccccc-7777-4000-8000-0000000000c9";
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${otherTenant}, true)`;
      await sql`INSERT INTO bounces.suppression_list
        (id, tenant_id, recipient, recipient_hash, channel, reason, source, created_by, updated_by)
        VALUES (${randomUUID()}, ${otherTenant}, ${encryptPii(recipient)}, ${blindIndex(recipient)},
                'email', 'hard_bounce', 'bounce', ${SYSTEM}, ${SYSTEM})`;
    });

    await send({ templateId: TEMPLATE, recipient, recipientId, eventType: "gate.crosstenant" });

    const rows = await deliveriesFor(recipientId);
    expect(rows[0]?.status).toBe("delivered");

    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${otherTenant}, true)`;
      await sql`DELETE FROM bounces.suppression_list WHERE tenant_id = ${otherTenant}`;
    });
  });
});

describe("R1 gate (consumer) — DND window defers instead of sending", () => {
  it("an active DND window skips the send and parks it for release", async () => {
    const recipientId = randomUUID();
    await seedActiveDndWindow(recipientId);

    await send({ templateId: TEMPLATE, recipient: "quiet@dept.gov.in", recipientId, eventType: "gate.dnd" });

    expect(sendSpy).not.toHaveBeenCalled();

    const rows = await deliveriesFor(recipientId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).not.toBe("delivered");
    // Deferred, not refused — and with no retry timestamp, so the durable retry
    // sweeper cannot republish it alongside the DND release sweeper.
    expect(rows[0]?.status).toBe("queued");
    expect(rows[0]?.next_retry_at).toBeNull();

    const held = await sqlAsTenant((sql) => sql`
      SELECT status, hold_until, delivery_payload FROM dnd.held_notifications
      WHERE tenant_id = ${TENANT} AND user_id = ${recipientId}`) as unknown as
      { status: string; hold_until: Date; delivery_payload: { deliveryId?: string } }[];
    expect(held).toHaveLength(1);
    expect(held[0]?.status).toBe("held");
    // The release must update the SAME delivery row, not create a second one.
    expect(held[0]?.delivery_payload?.deliveryId).toBeTruthy();
  });

  it("a DISABLED window does not hold the send", async () => {
    const recipientId = randomUUID();
    await seedActiveDndWindow(recipientId);
    await sqlAsTenant((sql) => sql`
      UPDATE dnd.dnd_windows SET enabled = false WHERE tenant_id = ${TENANT} AND user_id = ${recipientId}`);

    await send({ templateId: TEMPLATE, recipient: "loud@dept.gov.in", recipientId, eventType: "gate.dnd.off" });

    const rows = await deliveriesFor(recipientId);
    expect(rows[0]?.status).toBe("delivered");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});

describe("R1 gate (consumer) — CRM marketing consent", () => {
  it("marketing_consent=false skips the send and NO adapter is invoked", async () => {
    const recipientId = randomUUID();
    setConsentLookupForTests(async () => "denied");

    await send({
      templateId: TEMPLATE, recipient: "nomarketing@dept.gov.in", recipientId,
      eventType: "gate.marketing", category: "marketing",
    });

    const rows = await deliveriesFor(recipientId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("skipped");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("an unavailable CRM fails CLOSED — the marketing send is skipped, not sent", async () => {
    const recipientId = randomUUID();
    setConsentLookupForTests(async () => "unknown");

    await send({
      templateId: TEMPLATE, recipient: "unverifiable@dept.gov.in", recipientId,
      eventType: "gate.marketing.unknown", category: "marketing",
    });

    expect((await deliveriesFor(recipientId))[0]?.status).toBe("skipped");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("marketing_consent=true is delivered", async () => {
    const recipientId = randomUUID();
    setConsentLookupForTests(async () => "granted");

    await send({
      templateId: TEMPLATE, recipient: "optedin@dept.gov.in", recipientId,
      eventType: "gate.marketing.ok", category: "marketing",
    });

    expect((await deliveriesFor(recipientId))[0]?.status).toBe("delivered");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("a transactional send never consults CRM consent", async () => {
    const recipientId = randomUUID();
    const lookup = vi.fn(async () => "denied" as const);
    setConsentLookupForTests(lookup);

    await send({
      templateId: TEMPLATE, recipient: "operational@dept.gov.in", recipientId,
      eventType: "hrms.leave.approved",
    });

    expect(lookup).not.toHaveBeenCalled();
    expect((await deliveriesFor(recipientId))[0]?.status).toBe("delivered");
  });
});

describe("R1 gate (consumer) — per-channel consent", () => {
  it("an explicit channel override cannot defeat a per-channel opt-out", async () => {
    const recipientId = randomUUID();
    // Consented to email, never opted in to SMS. The caller asks for SMS.
    await seedPref(recipientId, "gate.channel", { email: true, sms: false });

    await send({
      templateId: TEMPLATE, recipient: "emailonly@dept.gov.in", recipientId,
      eventType: "gate.channel", channel: "sms",
    });

    const rows = await deliveriesFor(recipientId);
    expect(rows[0]?.status).toBe("delivered");
    // Delivered on the consented channel, NOT the requested one.
    expect(rows[0]?.channel).toBe("email");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("a recipient with no consented channel at all is skipped", async () => {
    const recipientId = randomUUID();
    await seedPref(recipientId, "gate.none", {});

    await send({
      templateId: TEMPLATE, recipient: "nochannel@dept.gov.in", recipientId,
      eventType: "gate.none",
    });

    expect((await deliveriesFor(recipientId))[0]?.status).toBe("skipped");
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("a recipient with no pref row still receives transactional email", async () => {
    const recipientId = randomUUID();
    await send({
      templateId: TEMPLATE, recipient: "default@dept.gov.in", recipientId, eventType: "gate.default",
    });
    expect((await deliveriesFor(recipientId))[0]?.status).toBe("delivered");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * Regression for the High defect introduced by the first cut of the R1 gate
 * (PR #417, merged as 77888af): the TRAI/DLT "no opt-in recorded → refuse"
 * rule was applied to EVERY send instead of marketing only. A transactional
 * `channel: "sms"` to a recipient with no pref row had SMS stripped from the
 * attempt list and fell through to the email fallback — which then handed a
 * phone number to the email adapter as the address.
 *
 * Real traffic that broke: court-service login OTP SMS and visitor-service
 * emergency evacuation SMS.
 */
describe("R1 gate — TRANSACTIONAL sms/whatsapp must not require a marketing opt-in", () => {
  // The sms adapter fails closed without Twilio credentials (`stub` driver), and
  // a failed adapter falls back to email — which would mask the very routing
  // decision under test. Stand in for a configured provider so these assertions
  // are about the GATE's channel selection and nothing else.
  beforeEach(() => {
    smsSpy.mockResolvedValue({ ok: true });
  });

  it("a transactional sms to a phone-number recipient with NO pref row is delivered on sms", async () => {
    const recipientId = randomUUID();
    const phone = "+919812345670";

    await send({
      templateId: TEMPLATE, recipient: phone, recipientId,
      eventType: "gate.transactional.sms", channel: "sms",
    });

    const rows = await deliveriesFor(recipientId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("delivered");
    // The whole point: sms, NOT the email fallback.
    expect(rows[0]?.channel).toBe("sms");
    expect(smsSpy).toHaveBeenCalledTimes(1);
    // A phone number must never be handed to the email adapter as an address.
    expect(sendSpy).not.toHaveBeenCalled();
    expect(smsSpy.mock.calls[0]?.[0]).toMatchObject({ recipient: phone });
  });

  it("court-service login OTP SMS reaches the sms adapter", async () => {
    const recipientId = randomUUID();
    await send({
      templateId: TEMPLATE, recipient: "+919812345671", recipientId,
      eventType: "court.login.otp", channel: "sms",
    });

    expect((await deliveriesFor(recipientId))[0]?.channel).toBe("sms");
    expect(smsSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("visitor-service emergency evacuation SMS reaches the sms adapter", async () => {
    const recipientId = randomUUID();
    await send({
      templateId: TEMPLATE, recipient: "+919812345672", recipientId,
      eventType: "visitor.emergency.evacuation", channel: "sms",
      category: "transactional",
    });

    expect((await deliveriesFor(recipientId))[0]?.channel).toBe("sms");
    expect(smsSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("a pref row that records NO sms choice does not block a transactional sms", async () => {
    const recipientId = randomUUID();
    // The recipient configured email; the sms column stays NULL (never asked).
    await seedPref(recipientId, "gate.tri.null", { email: true });

    await send({
      templateId: TEMPLATE, recipient: "+919812345673", recipientId,
      eventType: "gate.tri.null", channel: "sms",
    });

    expect((await deliveriesFor(recipientId))[0]?.channel).toBe("sms");
    expect(smsSpy).toHaveBeenCalledTimes(1);
  });

  it("an EXPLICIT sms opt-out still blocks a transactional sms and falls back to email", async () => {
    const recipientId = randomUUID();
    await seedPref(recipientId, "gate.tri.optout", { email: true, sms: false });

    await send({
      templateId: TEMPLATE, recipient: "optout@dept.gov.in", recipientId,
      eventType: "gate.tri.optout", channel: "sms",
    });

    expect((await deliveriesFor(recipientId))[0]?.channel).toBe("email");
    expect(smsSpy).not.toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("a MARKETING sms with no recorded opt-in is still refused on sms (TRAI/DLT intact)", async () => {
    const recipientId = randomUUID();
    setConsentLookupForTests(async () => "granted");

    await send({
      templateId: TEMPLATE, recipient: "marketing@dept.gov.in", recipientId,
      eventType: "marketing.offer", channel: "sms", category: "marketing",
    });

    // CRM said yes to marketing, but the commercial CHANNEL was never opted in,
    // so sms is dropped from the attempt list and only the email fallback runs.
    expect(smsSpy).not.toHaveBeenCalled();
    expect((await deliveriesFor(recipientId))[0]?.channel).toBe("email");
  });

  it("a MARKETING sms with no recorded opt-in AND no other consented channel is skipped", async () => {
    const recipientId = randomUUID();
    setConsentLookupForTests(async () => "granted");
    // Email refused, sms never opted in → nothing left to attempt.
    await seedPref(recipientId, "marketing.offer.none", { email: false, sms: null });

    await send({
      templateId: TEMPLATE, recipient: "+919812345674", recipientId,
      eventType: "marketing.offer.none", channel: "sms", category: "marketing",
    });

    expect((await deliveriesFor(recipientId))[0]?.status).toBe("skipped");
    expect(smsSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("a MARKETING sms IS delivered once the recipient opted in to the channel", async () => {
    const recipientId = randomUUID();
    setConsentLookupForTests(async () => "granted");
    await seedPref(recipientId, "marketing.offer.ok", { sms: true });

    await send({
      templateId: TEMPLATE, recipient: "+919812345675", recipientId,
      eventType: "marketing.offer.ok", channel: "sms", category: "marketing",
    });

    expect((await deliveriesFor(recipientId))[0]?.channel).toBe("sms");
    expect(smsSpy).toHaveBeenCalledTimes(1);
  });
});

describe("R1 gate (bulk) — campaign fan-out is gated before it publishes", () => {
  it("a suppressed campaign recipient is marked skipped and gets no send command", async () => {
    const campaignId = randomUUID();
    const blocked = randomUUID();
    const allowed = randomUUID();
    await suppress(blocked);

    await sqlAsTenant(async (sql) => {
      await sql`INSERT INTO bulk.campaigns (id, tenant_id, template_id, name, status, created_by, updated_by)
        VALUES (${campaignId}, ${TENANT}, ${TEMPLATE}, 'Gated blast', 'draft', ${SYSTEM}, ${SYSTEM})`;
      for (const recipientId of [blocked, allowed]) {
        await sql`INSERT INTO bulk.campaign_recipients (id, tenant_id, campaign_id, recipient_id, status, created_by, updated_by)
          VALUES (${randomUUID()}, ${TENANT}, ${campaignId}, ${recipientId}, 'pending', ${SYSTEM}, ${SYSTEM})`;
      }
    });

    const q = new MemoryQueue();
    registerBulkConsumers(q);
    await q.start();
    await q.publish("notification.campaign.send", {
      messageId: randomUUID(), type: "notification.campaign.send", tenantId: TENANT, actorId: SYSTEM,
      correlationId: randomUUID(), schemaVersion: "1.0", payload: { id: campaignId, tenantId: TENANT },
    });
    await q.drain();
    // A dead-lettered command would leave every recipient at `pending` and make
    // the assertions below pass for the wrong reason.
    expect(q.dlq).toEqual([]);

    const rows = await sqlAsTenant((sql) => sql`
      SELECT recipient_id, status FROM bulk.campaign_recipients WHERE campaign_id = ${campaignId}`) as unknown as
      { recipient_id: string; status: string }[];
    const byId = new Map(rows.map((r) => [r.recipient_id, r.status]));
    expect(byId.get(blocked)).toBe("skipped");
    expect(byId.get(allowed)).toBe("queued");

    // The fan-out publishes through the transactional outbox: the suppressed
    // recipient must have no send command there at all.
    const queued = await sqlClient`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND topic = 'notification.send'` as unknown as
      { payload: { recipientId: string; campaignId?: string; category?: string } }[];
    const recipients = queued.map((m) => m.payload.recipientId);
    expect(recipients).toContain(allowed);
    expect(recipients).not.toContain(blocked);
    // Downstream must know this is a campaign so the per-recipient send applies
    // the CRM marketing-consent check.
    expect(queued.find((m) => m.payload.recipientId === allowed)?.payload.category).toBe("marketing");
  });
});
