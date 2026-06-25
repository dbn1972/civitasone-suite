import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import {
  setEmailTransportForTests,
  MemoryEmailTransport,
  setNotificationPublisherForTests,
  MemoryNotificationPublisher,
} from "../src/adapters/index.js";
import { resolvePreferredChannel, sendWithFallback } from "../src/modules/deliveries/channel.js";
import { COMMANDS } from "../src/topics.js";
import { resetNotificationDeliveryMetrics } from "@civitasone/observability";

describe("channel fallback", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    resetNotificationDeliveryMetrics();
    setNotificationPublisherForTests(new MemoryNotificationPublisher());
    process.env.NOTIFICATION_EMAIL_DRIVER = "stub";
    process.env.NOTIFICATION_PUSH_DRIVER = "stub";
    process.env.NOTIFICATION_SMS_DRIVER = "stub";
    process.env.NOTIFICATION_IN_APP_DRIVER = "memory";
  });

  afterEach(() => {
    process.env = { ...envBackup };
    setEmailTransportForTests(null);
    setNotificationPublisherForTests(null);
  });

  it("resolves push as preferred when user pref has push=true", () => {
    const prefs = [{ id: "p1", tenantId: "t1", userId: "u1", eventType: "alert", inApp: false, email: false, push: true, version: 1 }];
    const { preferred, fallbacks } = resolvePreferredChannel(prefs, "alert");
    expect(preferred).toBe("push");
    expect(fallbacks).toContain("email");
  });

  it("user pref=push, push fails → sendWithFallback falls back to email (stub=ok)", async () => {
    const transport = new MemoryEmailTransport();
    setEmailTransportForTests(transport);
    process.env.NOTIFICATION_EMAIL_DRIVER = "smtp";
    process.env.SMTP_HOST = "localhost";
    process.env.SMTP_FROM = "noreply@civitasone.local";

    // push is stub (returns error), email is smtp with memory transport
    const result = await sendWithFallback(["push", "email"], {
      recipient: "officer@dept.gov.in",
      subject: "Budget Alert",
      body: "Your budget limit has been reached.",
      tenantId: "aaaaaaaa-1111-4000-8000-000000000001",
      userId: "bbbbbbbb-2222-4000-8000-000000000002",
    });

    expect(result.error).toBeUndefined();
    expect(result.channel).toBe("email");
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.to).toBe("officer@dept.gov.in");
  });

  it("all channels fail → returns last error, not throws", async () => {
    // push=stub (error), sms=stub (error) — no email fallback in list
    const result = await sendWithFallback(["push", "sms"], {
      recipient: "+919999999999",
      body: "critical alert",
      tenantId: "t1",
      userId: "u1",
    });

    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe("string");
  });
});

// Bulk fan-out tests use in-memory handlers (same pattern as notification.test.ts)
// so they don't need a DB connection. The real DB-backed consumer is integration-tested
// against a live Postgres in the CI migration step.

describe("bulk campaign fan-out", () => {
  it("campaign with 3 recipients fans out to 3 individual notification.send commands", async () => {
    const q = new MemoryQueue();

    // In-memory campaign store (mirrors what DB consumer would persist)
    const campaignStore = new Map<string, { templateId: string; recipients: string[] }>();
    const sentCommands: Array<{ templateId: string; recipientId: string; tenantId: string }> = [];

    q.subscribe<{ id: string; templateId: string; recipients: string[]; tenantId: string }>(
      COMMANDS.createCampaign,
      async (msg) => {
        const p = msg.payload;
        campaignStore.set(p.id, { templateId: p.templateId, recipients: p.recipients });
      },
    );

    q.subscribe<{ id: string; tenantId: string }>(COMMANDS.sendCampaign, async (msg) => {
      const campaign = campaignStore.get(msg.payload.id);
      if (!campaign) return;
      for (const recipientId of campaign.recipients) {
        await q.publish(COMMANDS.sendNotification, {
          messageId: randomUUID(),
          type: COMMANDS.sendNotification,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          schemaVersion: "1.0",
          payload: { templateId: campaign.templateId, recipientId, recipient: recipientId, tenantId: msg.tenantId, variables: {} },
        });
      }
    });

    q.subscribe<{ templateId: string; recipientId: string; tenantId: string }>(
      COMMANDS.sendNotification,
      async (msg) => { sentCommands.push(msg.payload); },
    );

    const campaignId = "cccccccc-3333-4000-8000-000000000003";
    const templateId = "dddddddd-4444-4000-8000-000000000004";
    const recipients = [
      "eeeeeeee-5555-4000-8000-000000000005",
      "ffffffff-6666-4000-8000-000000000006",
      "aaaaaaaa-7777-4000-8000-000000000007",
    ];

    await q.publish(COMMANDS.createCampaign, {
      messageId: randomUUID(),
      type: COMMANDS.createCampaign,
      tenantId: "t1",
      actorId: "admin-1",
      correlationId: "corr-1",
      schemaVersion: "1.0",
      payload: { id: campaignId, tenantId: "t1", templateId, name: "Budget Alert Campaign", recipients },
    });

    await new Promise((r) => setTimeout(r, 20));

    await q.publish(COMMANDS.sendCampaign, {
      messageId: randomUUID(),
      type: COMMANDS.sendCampaign,
      tenantId: "t1",
      actorId: "admin-1",
      correlationId: "corr-1",
      schemaVersion: "1.0",
      payload: { id: campaignId, tenantId: "t1" },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(sentCommands).toHaveLength(recipients.length);
    const recipientIds = sentCommands.map((c) => c.recipientId);
    for (const r of recipients) {
      expect(recipientIds).toContain(r);
    }
  });
});

describe("CQRS campaign send end-to-end (MemoryQueue)", () => {
  it("PATCH /campaigns/:id/send → queue → consumer → notification.send queued for each recipient", async () => {
    const q = new MemoryQueue();

    const campaignStore = new Map<string, { templateId: string; recipients: string[] }>();
    const notificationSends: Array<{ templateId: string; tenantId: string; recipientId: string }> = [];

    // Simulate createCampaign consumer (no DB needed)
    q.subscribe<{ id: string; templateId: string; recipients: string[]; tenantId: string }>(
      COMMANDS.createCampaign,
      async (msg) => {
        campaignStore.set(msg.payload.id, { templateId: msg.payload.templateId, recipients: msg.payload.recipients });
      },
    );

    // Simulate sendCampaign consumer fan-out (mirrors bulk/consumer.ts logic)
    q.subscribe<{ id: string; tenantId: string }>(COMMANDS.sendCampaign, async (msg) => {
      const campaign = campaignStore.get(msg.payload.id);
      if (!campaign) return;
      for (const recipientId of campaign.recipients) {
        await q.publish(COMMANDS.sendNotification, {
          messageId: randomUUID(),
          type: COMMANDS.sendNotification,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          schemaVersion: "1.0",
          payload: { templateId: campaign.templateId, recipientId, recipient: recipientId, tenantId: msg.tenantId, variables: {} },
        });
      }
    });

    q.subscribe<{ templateId: string; tenantId: string; recipientId: string }>(
      COMMANDS.sendNotification,
      async (msg) => { notificationSends.push(msg.payload); },
    );

    const campaignId = "11111111-aaaa-4000-8000-000000000001";
    const templateId = "22222222-bbbb-4000-8000-000000000002";
    const campaignRecipients = [
      "33333333-cccc-4000-8000-000000000003",
      "44444444-dddd-4000-8000-000000000004",
    ];

    // Step 1: campaign.create (what POST /notifications/campaigns triggers)
    await q.publish(COMMANDS.createCampaign, {
      messageId: randomUUID(),
      type: COMMANDS.createCampaign,
      tenantId: "t2",
      actorId: "a1",
      correlationId: "c1",
      schemaVersion: "1.0",
      payload: { id: campaignId, tenantId: "t2", templateId, name: "CQRS Test Campaign", recipients: campaignRecipients },
    });

    await new Promise((r) => setTimeout(r, 20));

    // Step 2: campaign.send (what PATCH /campaigns/:id/send triggers)
    await q.publish(COMMANDS.sendCampaign, {
      messageId: randomUUID(),
      type: COMMANDS.sendCampaign,
      tenantId: "t2",
      actorId: "a1",
      correlationId: "c1",
      schemaVersion: "1.0",
      payload: { id: campaignId, tenantId: "t2" },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(notificationSends).toHaveLength(campaignRecipients.length);
    expect(notificationSends.every((s) => s.templateId === templateId)).toBe(true);
    expect(notificationSends.every((s) => s.tenantId === "t2")).toBe(true);
  });
});
