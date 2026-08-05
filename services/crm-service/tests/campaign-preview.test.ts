/**
 * Gap 1 — Campaign cost preview route tests.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000aef001";
const ACTOR = "cccccccc-3333-4000-8000-000000aef001";
const CONTACT_1 = "11111111-aaaa-4000-8000-000000aef002";
const CONTACT_2 = "11111111-aaaa-4000-8000-000000aef003";
const CONTACT_3 = "11111111-aaaa-4000-8000-000000aef004";
const TEMPLATE_ID = "99999999-dddd-4000-8000-000000aef005";

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function cleanup() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

async function seedContacts() {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    // 3 contacts: 2 with consent, 1 without
    await tx`INSERT INTO crm.contacts (id, tenant_id, name, email, status, marketing_consent, created_by, updated_by)
      VALUES
        (${CONTACT_1}, ${TENANT}, 'Alice A', 'alice-prev@test.com', 'active', true, ${ACTOR}, ${ACTOR}),
        (${CONTACT_2}, ${TENANT}, 'Bob B', 'bob-prev@test.com', 'active', true, ${ACTOR}, ${ACTOR}),
        (${CONTACT_3}, ${TENANT}, 'Charlie C', 'charlie-prev@test.com', 'active', false, ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING`;
  });
}

beforeAll(async () => {
  await cleanup();
  await seedContacts();
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("Gap 1: campaign cost preview", () => {
  it("returns preview with recipient count and cost estimate (200)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/preview",
      headers: headers(),
      payload: {
        contactIds: [CONTACT_1, CONTACT_2, CONTACT_3],
        channel: "sms",
        templateId: TEMPLATE_ID,
      },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.recipientCount).toBe(3);
    expect(body.data.consentedCount).toBe(2);
    expect(body.data.estimatedCostMinor).toBe(2 * 25); // 2 consented × 25 paise/sms
    expect(body.data.channel).toBe("sms");
    expect(body.data.currency).toBe("INR");
  });

  it("requires authentication (401)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/preview",
      payload: { contactIds: [CONTACT_1], channel: "email", templateId: TEMPLATE_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("requires correct role (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/preview",
      headers: headers(["employee"]),
      payload: { contactIds: [CONTACT_1], channel: "email", templateId: TEMPLATE_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("rejects with no filter (400)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/communications/preview",
      headers: headers(),
      payload: { channel: "email", templateId: TEMPLATE_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
