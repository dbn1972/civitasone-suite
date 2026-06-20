import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  emailAdapter,
  inAppAdapter,
  smsAdapter,
  whatsAppAdapter,
  setEmailTransportForTests,
  MemoryEmailTransport,
  setNotificationPublisherForTests,
  MemoryNotificationPublisher,
} from "../src/adapters/index.js";
import { inAppChannel } from "../src/adapters/in_app.js";
import { sendWithFallback } from "../src/modules/deliveries/channel.js";
import { incrementNotificationDelivery, resetNotificationDeliveryMetrics } from "@civitasone/observability";

describe("notification adapters", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    resetNotificationDeliveryMetrics();
    setEmailTransportForTests(null);
    setNotificationPublisherForTests(new MemoryNotificationPublisher());
    process.env.NOTIFICATION_IN_APP_DRIVER = "memory";
  });

  afterEach(() => {
    process.env = { ...envBackup };
    setEmailTransportForTests(null);
    setNotificationPublisherForTests(null);
  });

  describe("email (memory transport)", () => {
    it("delivers via injected memory transport when driver=smtp", async () => {
      const transport = new MemoryEmailTransport();
      setEmailTransportForTests(transport);
      process.env.NOTIFICATION_EMAIL_DRIVER = "smtp";
      process.env.SMTP_HOST = "localhost";
      process.env.SMTP_FROM = "test@civitasone.local";

      const result = await emailAdapter.send({
        recipient: "user@dept.gov.in",
        subject: "Welcome",
        body: "Hello {{name}}",
        variables: { name: "Officer" },
      });

      expect(result).toEqual({ ok: true });
      expect(transport.sent).toHaveLength(1);
      expect(transport.sent[0]).toMatchObject({
        to: "user@dept.gov.in",
        from: "test@civitasone.local",
        subject: "Welcome",
        text: "Hello Officer",
      });
    });

    it("stub driver accepts without transport", async () => {
      process.env.NOTIFICATION_EMAIL_DRIVER = "stub";
      const result = await emailAdapter.send({ recipient: "a@b.com", body: "hi" });
      expect(result).toEqual({ ok: true });
    });

    it("smtp driver fails when SMTP_FROM missing", async () => {
      process.env.NOTIFICATION_EMAIL_DRIVER = "smtp";
      delete process.env.SMTP_FROM;
      const result = await emailAdapter.send({ recipient: "a@b.com", body: "hi" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("SMTP_FROM");
    });
  });

  describe("in_app (memory pub/sub)", () => {
    it("publishes to notifications:{tenantId}:{userId}", async () => {
      const publisher = new MemoryNotificationPublisher();
      setNotificationPublisherForTests(publisher);
      const tenantId = "aaaaaaaa-1111-4000-8000-000000000001";
      const userId = "bbbbbbbb-2222-4000-8000-000000000002";

      const result = await inAppAdapter.send({
        tenantId,
        userId,
        recipient: userId,
        subject: "Alert",
        body: "New message",
      });

      expect(result).toEqual({ ok: true });
      const channel = inAppChannel(tenantId, userId);
      expect(publisher.messages.get(channel)).toHaveLength(1);
      const payload = JSON.parse(publisher.messages.get(channel)![0]!);
      expect(payload.body).toBe("New message");
      expect(payload.subject).toBe("Alert");
    });

    it("requires tenantId", async () => {
      const result = await inAppAdapter.send({ recipient: "u1", body: "hi" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("tenantId");
    });
  });

  describe("SMS / WhatsApp feature flags", () => {
    it("sms stub returns not configured error", async () => {
      process.env.NOTIFICATION_SMS_DRIVER = "stub";
      const result = await smsAdapter.send({ recipient: "+919999999999", body: "hi" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("SMS not configured");
    });

    it("whatsapp stub returns not configured error", async () => {
      process.env.NOTIFICATION_WHATSAPP_DRIVER = "stub";
      const result = await whatsAppAdapter.send({ recipient: "+919999999999", body: "hi" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("WhatsApp not configured");
    });
  });

  describe("sendWithFallback + metrics", () => {
    it("records notification_delivery_total on success and failure", async () => {
      const transport = new MemoryEmailTransport();
      setEmailTransportForTests(transport);
      process.env.NOTIFICATION_EMAIL_DRIVER = "smtp";
      process.env.SMTP_HOST = "localhost";
      process.env.SMTP_FROM = "test@civitasone.local";

      await sendWithFallback(["email"], {
        recipient: "ok@example.com",
        body: "test",
        tenantId: "t1",
        userId: "u1",
      });

      incrementNotificationDelivery("email", "success");
      incrementNotificationDelivery("sms", "failed");

      process.env.NOTIFICATION_SMS_DRIVER = "stub";
      await sendWithFallback(["sms", "email"], {
        recipient: "fallback@example.com",
        body: "fallback",
        tenantId: "t1",
        userId: "u1",
      });

      expect(transport.sent.some((m) => m.to === "fallback@example.com")).toBe(true);
    });
  });
});
