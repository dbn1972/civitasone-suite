/**
 * Comprehensive route coverage tests for notification-service.
 * Covers all 22 routes: GET, POST, PATCH with valid payloads, auth, and validation.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "cccccccc-3333-4000-8000-000000000099";

function token(roles: string[] = ["notification_admin", "super_admin"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-cov" }, SECRET);
}

const adminToken = token();
const citizenToken = token(["citizen"]);

afterAll(async () => { await sqlClient.end(); });

// ─── TEMPLATES MODULE ──────────────────────────────────────────────────────────

describe("POST /notifications/templates", () => {
  it("returns 202 with valid body (admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/templates",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { channel: "email", name: "Welcome", body: "Hello {{name}}" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toHaveProperty("id");
    expect(res.json().status).toBe("accepted");
  });

  it("returns 400 for empty payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/templates",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/templates",
      headers: { authorization: `Bearer ${citizenToken}` },
      payload: { channel: "email", name: "Test", body: "Hi" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /notifications/templates", () => {
  it("returns 200 with array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/templates",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("PATCH /notifications/templates/:id", () => {
  it("returns 202 with valid body (admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/templates/${randomUUID()}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "Updated Name" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 for invalid uuid param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/notifications/templates/not-a-uuid",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { name: "x" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/templates/${randomUUID()}`,
      headers: { authorization: `Bearer ${citizenToken}` },
      payload: { name: "x" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /notifications/templates/:id/versions", () => {
  it("returns 200 with array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/notifications/templates/${randomUUID()}/versions`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 400 for invalid uuid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/templates/bad-uuid/versions",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ─── PREFERENCES (via templates routes) ────────────────────────────────────────

describe("POST /notifications/preferences/:userId", () => {
  it("returns 202 with valid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/notifications/preferences/${randomUUID()}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { eventType: "order.created", inApp: true, email: true },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 for empty payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/notifications/preferences/${randomUUID()}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid userId param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/preferences/not-uuid",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { eventType: "x", inApp: true, email: false },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /notifications/preferences/:userId", () => {
  it("returns 200 with array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/notifications/preferences/${randomUUID()}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 400 for invalid userId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/preferences/bad",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /notifications/prefs/:id", () => {
  it("returns 404 for non-existent pref id (valid uuid)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/prefs/${randomUUID()}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { email: true },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for empty body (no channel fields)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/prefs/${randomUUID()}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/prefs/${randomUUID()}`,
      headers: { authorization: `Bearer ${citizenToken}` },
      payload: { inApp: true },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ─── DELIVERIES MODULE ─────────────────────────────────────────────────────────

describe("POST /notifications/send", () => {
  it("returns 202 with valid payload (recipient)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/send",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        templateId: randomUUID(),
        recipient: "officer@dept.gov.in",
        channel: "email",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toHaveProperty("id");
  });

  it("returns 202 with recipientId instead of recipient", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/send",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        templateId: randomUUID(),
        recipientId: randomUUID(),
        channel: "sms",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("rejects empty payload with error status", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/send",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("rejects when neither recipient nor recipientId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/send",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { templateId: randomUUID() },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/send",
      headers: { authorization: `Bearer ${citizenToken}` },
      payload: { templateId: randomUUID(), recipient: "a@b.com" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /notifications/deliveries", () => {
  it("returns 200 with array (admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/deliveries",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("supports limit and offset params", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/deliveries?limit=10&offset=0",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/deliveries",
      headers: { authorization: `Bearer ${citizenToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /notifications/deliveries/:id", () => {
  it("returns 404 for non-existent delivery", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/notifications/deliveries/${randomUUID()}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("rejects invalid uuid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/deliveries/not-uuid",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/notifications/deliveries/${randomUUID()}`,
      headers: { authorization: `Bearer ${citizenToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ─── CHANNELS MODULE ───────────────────────────────────────────────────────────

describe("POST /notifications/channels", () => {
  it("returns 202 with valid body (admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/channels",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { type: "email", name: "Primary Email" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toHaveProperty("id");
  });

  it("rejects empty payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/channels",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("rejects invalid channel type", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/channels",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { type: "pigeon", name: "Avian" },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/channels",
      headers: { authorization: `Bearer ${citizenToken}` },
      payload: { type: "sms", name: "SMS" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /notifications/channels", () => {
  it("returns 200 with array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/channels",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

// ─── ALERTS MODULE ─────────────────────────────────────────────────────────────

describe("POST /notifications/alert-rules", () => {
  it("returns 202 with valid body (admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/alert-rules",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: "High CPU Alert",
        triggerEvent: "system.cpu.high",
        channel: "email",
        recipients: ["admin@dept.gov.in"],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toHaveProperty("id");
  });

  it("rejects empty payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/alert-rules",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/alert-rules",
      headers: { authorization: `Bearer ${citizenToken}` },
      payload: { name: "x", triggerEvent: "y", channel: "sms" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /notifications/alert-rules/:id/enable", () => {
  it("returns 202 with valid uuid (admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/alert-rules/${randomUUID()}/enable`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("rejects invalid uuid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/notifications/alert-rules/bad/enable",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

describe("PATCH /notifications/alert-rules/:id/disable", () => {
  it("returns 202 with valid uuid (admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/alert-rules/${randomUUID()}/disable`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("rejects invalid uuid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/notifications/alert-rules/xyz/disable",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/alert-rules/${randomUUID()}/disable`,
      headers: { authorization: `Bearer ${citizenToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /notifications/alert-rules", () => {
  it("returns 200 with array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/alert-rules",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

// ─── BULK / CAMPAIGNS MODULE ───────────────────────────────────────────────────

describe("POST /notifications/campaigns", () => {
  it("returns 202 with valid body (admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/campaigns",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        templateId: randomUUID(),
        name: "Q4 Campaign",
        recipients: ["user1@dept.gov.in", "user2@dept.gov.in"],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toHaveProperty("id");
  });

  it("rejects empty payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/campaigns",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("rejects empty recipients array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/campaigns",
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { templateId: randomUUID(), name: "x", recipients: [] },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/campaigns",
      headers: { authorization: `Bearer ${citizenToken}` },
      payload: { templateId: randomUUID(), name: "x", recipients: ["a"] },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /notifications/campaigns/:id/send", () => {
  it("returns 202 with valid uuid (admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/campaigns/${randomUUID()}/send`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("rejects invalid uuid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/notifications/campaigns/bad/send",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/campaigns/${randomUUID()}/send`,
      headers: { authorization: `Bearer ${citizenToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /notifications/campaigns/:id/cancel", () => {
  it("returns 202 with valid uuid (admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/notifications/campaigns/${randomUUID()}/cancel`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("rejects invalid uuid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/notifications/campaigns/bad/cancel",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

describe("GET /notifications/campaigns/:id", () => {
  it("returns 404 for non-existent campaign", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/notifications/campaigns/${randomUUID()}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("rejects invalid uuid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/campaigns/not-a-uuid",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

// ─── INBOX MODULE ──────────────────────────────────────────────────────────────

describe("GET /notifications/notifications", () => {
  it("returns 200 with array (any authenticated user)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/notifications",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("supports limit/offset query params", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/notifications?limit=5&offset=0",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/notifications",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /notifications/preferences (admin list)", () => {
  it("returns 200 with array (admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/preferences",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/preferences",
      headers: { authorization: `Bearer ${citizenToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ─── ADAPTER COVERAGE ──────────────────────────────────────────────────────────

describe("email adapter branches", () => {
  it("smtp driver without SMTP_HOST returns error", async () => {
    const { EmailAdapter } = await import("../src/adapters/email.js");
    const orig = { ...process.env };
    process.env.NOTIFICATION_EMAIL_DRIVER = "smtp";
    process.env.SMTP_FROM = "test@gov.in";
    delete process.env.SMTP_HOST;
    const adapter = new EmailAdapter();
    const r = await adapter.send({ recipient: "a@b.com", body: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("SMTP_HOST");
    process.env = { ...orig };
  });

  it("smtp driver without SMTP_FROM returns error", async () => {
    const { EmailAdapter } = await import("../src/adapters/email.js");
    const orig = { ...process.env };
    process.env.NOTIFICATION_EMAIL_DRIVER = "smtp";
    delete process.env.SMTP_FROM;
    process.env.SMTP_HOST = "mail.example.com";
    const adapter = new EmailAdapter();
    const r = await adapter.send({ recipient: "a@b.com", body: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("SMTP_FROM");
    process.env = { ...orig };
  });

  it("unsupported driver returns error", async () => {
    const { EmailAdapter } = await import("../src/adapters/email.js");
    const orig = { ...process.env };
    process.env.NOTIFICATION_EMAIL_DRIVER = "carrier_pigeon";
    const adapter = new EmailAdapter();
    const r = await adapter.send({ recipient: "a@b.com", body: "hi" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("not supported");
    process.env = { ...orig };
  });
});

describe("renderBody", () => {
  it("replaces placeholders with variables", async () => {
    const { renderBody } = await import("../src/adapters/render.js");
    expect(renderBody("Hello {{name}}", { name: "World" })).toBe("Hello World");
  });

  it("keeps unreplaced placeholders", async () => {
    const { renderBody } = await import("../src/adapters/render.js");
    expect(renderBody("Hi {{name}}", {})).toBe("Hi {{name}}");
  });

  it("returns body unchanged when no variables", async () => {
    const { renderBody } = await import("../src/adapters/render.js");
    expect(renderBody("Hello")).toBe("Hello");
  });
});

describe("smtp-sender", () => {
  it("dry-run when SMTP_HOST not set", async () => {
    const orig = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    const { sendEmail } = await import("../src/modules/email/smtp-sender.js");
    const r = await sendEmail("a@b.com", "sub", "<p>hi</p>");
    expect(r.sent).toBe(false);
    if (orig) process.env.SMTP_HOST = orig;
  });

  it("reports sent=true when SMTP_HOST is set", async () => {
    const orig = process.env.SMTP_HOST;
    process.env.SMTP_HOST = "smtp.example.com";
    const { sendEmail } = await import("../src/modules/email/smtp-sender.js");
    const r = await sendEmail("a@b.com", "sub", "<p>hi</p>");
    expect(r.sent).toBe(true);
    if (orig) process.env.SMTP_HOST = orig;
    else delete process.env.SMTP_HOST;
  });
});

// ─── HTTP-GATEWAY ──────────────────────────────────────────────────────────────

describe("postToGateway", () => {
  it("returns ok:false on network error", async () => {
    const { postToGateway } = await import("../src/adapters/http-gateway.js");
    const r = await postToGateway({ url: "http://127.0.0.1:1/never", timeoutMs: 500 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeDefined();
  });

  it("handles form-encoded body", async () => {
    const { postToGateway } = await import("../src/adapters/http-gateway.js");
    const r = await postToGateway({ url: "http://127.0.0.1:1/never", form: { key: "val" }, timeoutMs: 500 });
    expect(r.ok).toBe(false);
  });
});

// ─── ADAPTER getAdapter / getAdapterOrThrow ────────────────────────────────────

describe("adapter index", () => {
  it("getAdapter returns undefined for unknown type", async () => {
    const { getAdapter } = await import("../src/adapters/index.js");
    expect(getAdapter("pigeon")).toBeUndefined();
  });

  it("getAdapterOrThrow throws for unknown type", async () => {
    const { getAdapterOrThrow } = await import("../src/adapters/index.js");
    expect(() => getAdapterOrThrow("pigeon")).toThrow("unknown channel adapter");
  });

  it("getAdapter returns adapter for known types", async () => {
    const { getAdapter } = await import("../src/adapters/index.js");
    expect(getAdapter("email")).toBeDefined();
    expect(getAdapter("sms")).toBeDefined();
    expect(getAdapter("push")).toBeDefined();
    expect(getAdapter("in_app")).toBeDefined();
    expect(getAdapter("whatsapp")).toBeDefined();
  });
});

// ─── TOPICS constants ──────────────────────────────────────────────────────────

describe("topics", () => {
  it("exports COMMANDS and RESOURCE objects", async () => {
    const { COMMANDS, RESOURCE, SERVICE } = await import("../src/topics.js");
    expect(COMMANDS.sendNotification).toBe("notification.send");
    expect(RESOURCE.delivery).toBe("delivery");
    expect(SERVICE).toBe("notification");
  });
});
