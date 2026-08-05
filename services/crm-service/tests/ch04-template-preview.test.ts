/**
 * CH-04 — Template variable validation + resolved-sample preview.
 * Tests the template-preview endpoint and the send-route validation gate.
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000040001";
const ACTOR = "cccccccc-3333-4000-8000-000000040001";
const CONTACT_ID = "22222222-bbbb-4000-8000-000000040001";
const TEMPLATE_ID = "33333333-cccc-4000-8000-000000040001";

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

// Mock fetch for notification-service template calls
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  // Seed a contact
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, email, phone, company, city, designation, status, marketing_consent, created_by, updated_by, version)
      VALUES (${CONTACT_ID}, ${TENANT}, 'John Doe', 'john@example.com', '+919876543210', 'Acme Inc', 'Mumbai', 'CTO', 'active', true, ${ACTOR}, ${ACTOR}, 1)
      ON CONFLICT (id) DO NOTHING
    `;
  });
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.contacts WHERE id = ${CONTACT_ID}`.catch(() => {});
  }).catch(() => {});
  await sqlClient.end();
});

describe("CH-04: Template Preview", () => {
  it("preview with all vars supplied → resolvedBody has no placeholders", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: TEMPLATE_ID, body: "Hello {{name}}, your order {{orderId}} is ready!" } }),
    }) as unknown as typeof fetch;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/template-preview",
      headers: headers(),
      payload: { templateId: TEMPLATE_ID, contactId: CONTACT_ID, variables: { orderId: "ORD-123" } },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.resolvedBody).toBe("Hello John Doe, your order ORD-123 is ready!");
    expect(body.data.missingVariables).toEqual([]);
    expect(body.data.sampleValues.name).toBe("John Doe");
    expect(body.data.sampleValues.orderId).toBe("ORD-123");
  });

  it("preview with missing vars → missingVariables lists them", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: TEMPLATE_ID, body: "Hello {{name}}, order {{orderId}} from {{warehouse}}" } }),
    }) as unknown as typeof fetch;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/template-preview",
      headers: headers(),
      payload: { templateId: TEMPLATE_ID, contactId: CONTACT_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.missingVariables).toContain("orderId");
    expect(body.data.missingVariables).toContain("warehouse");
    expect(body.data.resolvedBody).toContain("{{orderId}}");
    expect(body.data.resolvedBody).toContain("{{warehouse}}");
    // name is resolved from contact
    expect(body.data.resolvedBody).toContain("Hello John Doe");
    expect(body.data.sampleValues.name).toBe("John Doe");
  });

  it("send with missing mandatory var → 422", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: TEMPLATE_ID, body: "Hello {{name}}, your code is {{verificationCode}}" } }),
    }) as unknown as typeof fetch;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/send",
      headers: headers(),
      payload: {
        recipientContactId: CONTACT_ID,
        templateId: TEMPLATE_ID,
        channel: "email",
        // No variables provided — {{verificationCode}} is missing
      },
    });
    await app.close();

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe("MISSING_TEMPLATE_VARIABLES");
    expect(body.missingVars).toContain("verificationCode");
  });

  it("send with all vars → 202 as before", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { id: TEMPLATE_ID, body: "Hello {{name}}, your code is {{verificationCode}}" } }),
    }) as unknown as typeof fetch;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/send",
      headers: headers(),
      payload: {
        recipientContactId: CONTACT_ID,
        templateId: TEMPLATE_ID,
        channel: "email",
        variables: { verificationCode: "ABC123", name: "John Doe" },
      },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
  });

  it("requires authentication (401)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/template-preview",
      payload: { templateId: TEMPLATE_ID, contactId: CONTACT_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("requires appropriate role (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/template-preview",
      headers: headers(["employee"]),
      payload: { templateId: TEMPLATE_ID, contactId: CONTACT_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("template fetch fails (503) → returns 503 with graceful message", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/template-preview",
      headers: headers(),
      payload: { templateId: TEMPLATE_ID, contactId: CONTACT_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(503);
  });
});
