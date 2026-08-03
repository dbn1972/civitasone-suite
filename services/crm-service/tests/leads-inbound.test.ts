/**
 * Inbound lead capture tests (LM-005).
 *
 * Tests the POST /v1/crm/leads/inbound route (validation, auth, authz)
 * and the inbound consumer (idempotency, contact creation).
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

// Contact email/phone are AES-GCM encrypted at rest and fail closed without a
// key, so the capture consumer cannot write without one seeded here.
process.env.CRM_PII_KEY ??= "test_pii_key_for_crm_inbound_tests_aaaa";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000001";
const ACTOR = "cccccccc-3333-4000-8000-000000000001";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-inbound" }, SECRET);
}

function scoped<T>(fn: (tx: Parameters<Parameters<typeof sqlClient.begin>[0]>[0]) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("POST /v1/crm/leads/inbound", () => {
  const validPayload = {
    channel: "email",
    source: "marketing-campaign-q1",
    attributes: {
      name: "John Doe",
      email: "john@example.com",
      phone: "+919876543210",
      company: "Acme Corp",
    },
    metadata: { campaignId: "camp-123" },
  };

  describe("happy path", () => {
    it("returns 202 with accepted shape for valid inbound lead", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token()}` },
        payload: validPayload,
      });
      await app.close();

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe("accepted");
      expect(body.correlationId).toBeDefined();
    });

    it("accepts all valid channels", async () => {
      const app = await buildApp();
      const channels = ["email", "telephony", "chatbot", "whatsapp", "partner_api"] as const;

      for (const channel of channels) {
        const res = await app.inject({
          method: "POST",
          url: "/v1/crm/leads/inbound",
          headers: { authorization: `Bearer ${token()}` },
          payload: { ...validPayload, channel },
        });
        expect(res.statusCode).toBe(202);
      }
      await app.close();
    });

    it("allows integration_bot role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token(["integration_bot"])}` },
        payload: validPayload,
      });
      await app.close();

      expect(res.statusCode).toBe(202);
    });

    it("allows tenant_admin role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
        payload: validPayload,
      });
      await app.close();

      expect(res.statusCode).toBe(202);
    });
  });

  describe("validation (400)", () => {
    it("rejects missing channel", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token()}` },
        payload: { source: "test", attributes: {} },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("rejects invalid channel value", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token()}` },
        payload: { ...validPayload, channel: "sms" },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("rejects empty source", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token()}` },
        payload: { ...validPayload, source: "" },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("rejects invalid email in attributes", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token()}` },
        payload: { ...validPayload, attributes: { email: "not-an-email" } },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });

    it("rejects missing attributes object", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token()}` },
        payload: { channel: "email", source: "test" },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
    });
  });

  describe("authentication (401)", () => {
    it("returns 401 when no token is provided", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        payload: validPayload,
      });
      await app.close();

      expect(res.statusCode).toBe(401);
    });

    it("returns 401 with malformed token", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: "Bearer invalid.token.here" },
        payload: validPayload,
      });
      await app.close();

      expect(res.statusCode).toBe(401);
    });
  });

  describe("authorization (403)", () => {
    it("returns 403 for citizen role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token(["citizen"])}` },
        payload: validPayload,
      });
      await app.close();

      expect(res.statusCode).toBe(403);
    });

    it("returns 403 for employee role", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/crm/leads/inbound",
        headers: { authorization: `Bearer ${token(["employee"])}` },
        payload: validPayload,
      });
      await app.close();

      expect(res.statusCode).toBe(403);
    });
  });
});

/**
 * The route was already returning 202 for every case above while
 * registerInboundCaptureConsumer sat unwired in the worker — every inbound lead
 * from email, telephony, chatbot, whatsapp and partner APIs was discarded.
 */
describe("crm.lead.inbound_capture consumer creates the lead", () => {
  it("creates the contact with lead_status=new and the channel as lead source", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/leads/inbound",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        channel: "telephony",
        source: "inbound-ivr",
        attributes: {
          name: "Consumer Applied Lead",
          email: "consumer.applied@example.com",
          phone: "+919000000001",
          company: "Applied Corp",
          city: "Bhubaneswar",
        },
        metadata: { campaignId: "camp-apply" },
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);

    const contactId = res.json().contactId as string;
    expect(contactId).toBeDefined();

    await drainQueue();

    const rows = await scoped((tx) => tx<Array<{
      name: string; leadStatus: string; leadSource: string | null;
      company: string | null; email: string | null; emailIdx: string | null;
    }>>`
      SELECT name, lead_status AS "leadStatus", lead_source AS "leadSource",
             company, email, email_idx AS "emailIdx"
      FROM crm.contacts WHERE id = ${contactId} AND tenant_id = ${TENANT}
    `);
    expect(rows).toHaveLength(1);
    const contact = rows[0]!;
    expect(contact.name).toBe("Consumer Applied Lead");
    expect(contact.leadStatus).toBe("new");
    expect(contact.leadSource).toBe("telephony");
    expect(contact.company).toBe("Applied Corp");
    // PII is written through the repo, so it is ciphertext at rest and the blind
    // index that backs de-duplication is populated.
    expect(contact.email).not.toBe("consumer.applied@example.com");
    expect(contact.email?.startsWith("enc:v2:")).toBe(true);
    expect(contact.emailIdx).toBeTruthy();
  });

  it("emits crm.lead.captured without contact PII in the payload", async () => {
    const events = await scoped((tx) => tx<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'crm.lead.captured'
    `);
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const e of events) {
      expect(e.payload).not.toHaveProperty("attributes");
      expect(JSON.stringify(e.payload)).not.toContain("@example.com");
    }
  });

  it("audits a duplicate email as skipped instead of failing the delivery", async () => {
    const app = await buildApp();
    const payload = {
      channel: "email" as const,
      source: "duplicate-check",
      attributes: { name: "Duplicate Lead", email: "duplicate.lead@example.com" },
    };
    const first = await app.inject({
      method: "POST", url: "/v1/crm/leads/inbound",
      headers: { authorization: `Bearer ${token()}` }, payload,
    });
    await drainQueue();
    const second = await app.inject({
      method: "POST", url: "/v1/crm/leads/inbound",
      headers: { authorization: `Bearer ${token()}` }, payload,
    });
    await app.close();
    await drainQueue();

    const firstId = first.json().contactId as string;
    const secondId = second.json().contactId as string;

    const rows = await scoped((tx) => tx<Array<{ count: string }>>`
      SELECT count(*) AS count FROM crm.contacts
      WHERE tenant_id = ${TENANT} AND id IN (${firstId}, ${secondId})
    `);
    expect(rows[0]!.count).toBe("1");

    const audits = await scoped((tx) => tx<Array<{ payload: { outcome: string } }>>`
      SELECT payload FROM _outbox.messages
      WHERE tenant_id = ${TENANT} AND event_type = 'audit.event.record'
        AND payload->>'resourceId' = ${secondId}
    `);
    expect(audits.map((a) => a.payload.outcome)).toContain("duplicate_email_skipped");
  });
});

describe("inbound consumer (unit)", () => {
  it("registerInboundCaptureConsumer subscribes to correct topic", async () => {
    const { registerInboundCaptureConsumer } = await import("../src/modules/leads/inbound-consumer.js");
    const { COMMANDS } = await import("../src/topics.js");

    const subscriptions: string[] = [];
    const mockQueue = {
      subscribe: (topic: string, _handler: unknown) => { subscriptions.push(topic); },
      publish: vi.fn(),
    };

    registerInboundCaptureConsumer(mockQueue as never);
    expect(subscriptions).toContain(COMMANDS.inboundCapture);
  });
});
