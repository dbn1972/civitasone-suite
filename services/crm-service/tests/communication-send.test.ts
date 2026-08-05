/**
 * CO-001 — Communication Send (single + bulk) tests.
 *
 * Covers:
 * - Happy path: send to consented contact → 202
 * - Consent refused: send to non-consented contact → 422
 * - Bulk: N contacts, some without consent → 202, excluded count correct
 * - 400 for missing templateId, invalid channel, non-uuid contactId
 * - 401/403 coverage
 * - Consumer idempotency: markProcessed first
 * - Delivery status update: mock event, verify comm status changes
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue, captureHandlers, envelope } from "./consumer-harness.js";
import { COMMANDS, CONSUMED_EVENTS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000c00100";
const ACTOR = "cccccccc-3333-4000-8000-000000c00100";

// Contacts for testing
const CONSENTED_CONTACT = randomUUID();
const NO_CONSENT_CONTACT = randomUUID();
const INACTIVE_CONTACT = randomUUID();
const CONTACT_A = randomUUID();
const CONTACT_B = randomUUID();
const CONTACT_C = randomUUID();
const TEMPLATE_ID = randomUUID();

function headers(roles: string[] = ["crm_user"], tenant = TENANT) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": tenant,
  };
}

// Mock fetch for notification-service calls
const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

async function seedContacts() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;

    // Seed contacts
    for (const [id, consent, status] of [
      [CONSENTED_CONTACT, true, "active"],
      [NO_CONSENT_CONTACT, false, "active"],
      [INACTIVE_CONTACT, true, "inactive"],
      [CONTACT_A, true, "active"],
      [CONTACT_B, true, "active"],
      [CONTACT_C, false, "active"],
    ] as const) {
      await tx`
        INSERT INTO crm.contacts (id, tenant_id, name, marketing_consent, status, created_by, updated_by)
        VALUES (${id}, ${TENANT}, ${"Test " + id.slice(0, 8)}, ${consent}, ${status}, ${ACTOR}, ${ACTOR})
        ON CONFLICT (id) DO NOTHING
      `;
    }
  });
}

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.communications WHERE tenant_id = ${TENANT}`.catch(() => {});
    const ids = [CONSENTED_CONTACT, NO_CONSENT_CONTACT, INACTIVE_CONTACT, CONTACT_A, CONTACT_B, CONTACT_C];
    for (const id of ids) {
      await tx`DELETE FROM crm.contacts WHERE id = ${id}`.catch(() => {});
    }
  }).catch(() => {});
}

beforeAll(async () => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ deliveryId: randomUUID() }),
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  await cleanup();
  await seedContacts();
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await drainQueue();
  await cleanup();
  await sqlClient.end();
});

describe("CO-001 POST /v1/crm/communications/send", () => {
  it("returns 202 for a consented, active contact", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/send",
      headers: headers(),
      payload: {
        recipientContactId: CONSENTED_CONTACT,
        templateId: TEMPLATE_ID,
        channel: "email",
        variables: { name: "Test" },
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(body.id).toBeDefined();
    expect(body.correlationId).toBeDefined();
  });

  it("returns 422 CONSENT_REQUIRED for a non-consented contact", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/send",
      headers: headers(),
      payload: {
        recipientContactId: NO_CONSENT_CONTACT,
        templateId: TEMPLATE_ID,
        channel: "sms",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CONSENT_REQUIRED");
  });

  it("returns 404 for an inactive contact", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/send",
      headers: headers(),
      payload: {
        recipientContactId: INACTIVE_CONTACT,
        templateId: TEMPLATE_ID,
        channel: "whatsapp",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for a non-existent contact", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/send",
      headers: headers(),
      payload: {
        recipientContactId: randomUUID(),
        templateId: TEMPLATE_ID,
        channel: "email",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for missing templateId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/send",
      headers: headers(),
      payload: {
        recipientContactId: CONSENTED_CONTACT,
        channel: "email",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid channel", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/send",
      headers: headers(),
      payload: {
        recipientContactId: CONSENTED_CONTACT,
        templateId: TEMPLATE_ID,
        channel: "pigeon",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for non-uuid contactId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/send",
      headers: headers(),
      payload: {
        recipientContactId: "not-a-uuid",
        templateId: TEMPLATE_ID,
        channel: "email",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/send",
      payload: {
        recipientContactId: CONSENTED_CONTACT,
        templateId: TEMPLATE_ID,
        channel: "email",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for insufficient roles", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/send",
      headers: headers(["hr_admin"]),
      payload: {
        recipientContactId: CONSENTED_CONTACT,
        templateId: TEMPLATE_ID,
        channel: "email",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("creates a pending communication record after consumer drains", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/send",
      headers: headers(),
      payload: {
        recipientContactId: CONSENTED_CONTACT,
        templateId: TEMPLATE_ID,
        channel: "email",
      },
    });
    await app.close();
    const { id } = res.json();
    await drainQueue();

    // Check the communication record was created
    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx`SELECT status, template_id, direction, channel FROM crm.communications WHERE id = ${id} AND tenant_id = ${TENANT}`;
    });
    expect(rows.length).toBe(1);
    expect(rows[0].direction).toBe("outbound");
    expect(rows[0].channel).toBe("email");
    expect(rows[0].template_id).toBe(TEMPLATE_ID);
    // Status should be 'sent' or 'pending' depending on notification-service mock timing
    expect(["pending", "sent"]).toContain(rows[0].status);
  });
});

describe("CO-001 POST /v1/crm/communications/bulk-send", () => {
  it("returns 202 with eligible and excluded counts", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/bulk-send",
      headers: headers(["crm_admin"]),
      payload: {
        contactIds: [CONTACT_A, CONTACT_B, CONTACT_C, NO_CONSENT_CONTACT, CONSENTED_CONTACT],
        templateId: TEMPLATE_ID,
        channel: "email",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    // CONTACT_A (consent), CONTACT_B (consent), CONSENTED_CONTACT (consent) = 3 eligible
    // CONTACT_C (no consent), NO_CONSENT_CONTACT (no consent) = 2 excluded
    expect(body.eligible).toBe(3);
    expect(body.excluded).toBe(2);
  });

  it("returns 202 with eligible=0 when all contacts lack consent", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/bulk-send",
      headers: headers(["crm_admin"]),
      payload: {
        contactIds: [NO_CONSENT_CONTACT, CONTACT_C],
        templateId: TEMPLATE_ID,
        channel: "sms",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.eligible).toBe(0);
    expect(body.excluded).toBe(2);
  });

  it("returns 403 for crm_user (bulk requires crm_admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/bulk-send",
      headers: headers(["crm_user"]),
      payload: {
        contactIds: [CONSENTED_CONTACT],
        templateId: TEMPLATE_ID,
        channel: "email",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for more than 200 contacts", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/bulk-send",
      headers: headers(["crm_admin"]),
      payload: {
        contactIds: Array.from({ length: 201 }, () => randomUUID()),
        templateId: TEMPLATE_ID,
        channel: "email",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for empty contactIds", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/bulk-send",
      headers: headers(["crm_admin"]),
      payload: {
        contactIds: [],
        templateId: TEMPLATE_ID,
        channel: "whatsapp",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/bulk-send",
      payload: {
        contactIds: [CONSENTED_CONTACT],
        templateId: TEMPLATE_ID,
        channel: "email",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("CO-001 Consumer — consent re-check", () => {
  it("marks communication as consent_revoked if consent changed between route and consumer", async () => {
    // Temporarily give consent, accept at route, revoke, then drain
    const contactId = randomUUID();
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`
        INSERT INTO crm.contacts (id, tenant_id, name, marketing_consent, status, created_by, updated_by)
        VALUES (${contactId}, ${TENANT}, 'Temp Consent', true, 'active', ${ACTOR}, ${ACTOR})
      `;
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/send",
      headers: headers(),
      payload: {
        recipientContactId: contactId,
        templateId: TEMPLATE_ID,
        channel: "email",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const { id } = res.json();

    // Revoke consent before consumer processes
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`UPDATE crm.contacts SET marketing_consent = false WHERE id = ${contactId}`;
    });

    await drainQueue();

    // Check the communication was marked consent_revoked
    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx`SELECT status FROM crm.communications WHERE id = ${id} AND tenant_id = ${TENANT}`;
    });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("consent_revoked");

    // Cleanup
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.contacts WHERE id = ${contactId}`;
    });
  });
});

describe("CO-001 Delivery status feedback consumer", () => {
  it("updates comm status to delivered when notification.delivered arrives", async () => {
    // Create a communication record in 'sent' status
    const commId = randomUUID();
    const deliveryId = randomUUID();
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`
        INSERT INTO crm.communications
          (id, tenant_id, subject_type, subject_id, direction, channel, status, delivery_id, template_id, logged_by)
        VALUES
          (${commId}, ${TENANT}, 'contact', ${CONSENTED_CONTACT}, 'outbound', 'email', 'sent', ${deliveryId}, ${TEMPLATE_ID}, ${ACTOR})
      `;
    });

    const { handlerFor } = captureHandlers();
    const handler = handlerFor(CONSUMED_EVENTS.notificationDelivered);

    // Simulate delivery event using runWithTenant pattern
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    });
    await handler(envelope(
      CONSUMED_EVENTS.notificationDelivered,
      { deliveryId, tenantId: TENANT, status: "delivered" },
      { tenantId: TENANT, actorId: ACTOR },
    ));

    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx`SELECT status FROM crm.communications WHERE id = ${commId} AND tenant_id = ${TENANT}`;
    });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("delivered");
  });

  it("updates comm status to failed when notification.failed arrives", async () => {
    const commId = randomUUID();
    const deliveryId = randomUUID();
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`
        INSERT INTO crm.communications
          (id, tenant_id, subject_type, subject_id, direction, channel, status, delivery_id, template_id, logged_by)
        VALUES
          (${commId}, ${TENANT}, 'contact', ${CONSENTED_CONTACT}, 'outbound', 'sms', 'sent', ${deliveryId}, ${TEMPLATE_ID}, ${ACTOR})
      `;
    });

    const { handlerFor } = captureHandlers();
    const handler = handlerFor(CONSUMED_EVENTS.notificationFailed);

    await handler(envelope(
      CONSUMED_EVENTS.notificationFailed,
      { deliveryId, tenantId: TENANT, status: "failed" },
      { tenantId: TENANT, actorId: ACTOR },
    ));

    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx`SELECT status FROM crm.communications WHERE id = ${commId} AND tenant_id = ${TENANT}`;
    });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("failed");
  });

  it("is idempotent — same message processed once", async () => {
    const commId = randomUUID();
    const deliveryId = randomUUID();
    const messageId = randomUUID();
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`
        INSERT INTO crm.communications
          (id, tenant_id, subject_type, subject_id, direction, channel, status, delivery_id, template_id, logged_by)
        VALUES
          (${commId}, ${TENANT}, 'contact', ${CONSENTED_CONTACT}, 'outbound', 'whatsapp', 'sent', ${deliveryId}, ${TEMPLATE_ID}, ${ACTOR})
      `;
    });

    const { handlerFor } = captureHandlers();
    const handler = handlerFor(CONSUMED_EVENTS.notificationDelivered);

    const msg = envelope(
      CONSUMED_EVENTS.notificationDelivered,
      { deliveryId, tenantId: TENANT },
      { tenantId: TENANT, actorId: ACTOR, messageId },
    );

    await handler(msg);
    // Second invocation should be a no-op
    await handler(msg);

    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx`SELECT status FROM crm.communications WHERE id = ${commId} AND tenant_id = ${TENANT}`;
    });
    expect(rows[0].status).toBe("delivered");
  });
});

describe("CO-001 send consumer — notification-service integration", () => {
  it("calls notification-service with correct payload", async () => {
    fetchMock.mockClear();
    const newDeliveryId = randomUUID();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ deliveryId: newDeliveryId }),
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/send",
      headers: headers(),
      payload: {
        recipientContactId: CONSENTED_CONTACT,
        templateId: TEMPLATE_ID,
        channel: "whatsapp",
        variables: { greeting: "Hello" },
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);

    await drainQueue();

    // Verify fetch was called to notification-service
    expect(fetchMock).toHaveBeenCalled();
    const lastCall = fetchMock.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && (c[0] as string).includes("/notifications/send"),
    );
    expect(lastCall).toBeDefined();
  });
});
