/**
 * Contact roles tests (CM-003).
 * Tests CRUD for relationship roles and stakeholder views.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000020";
const ACTOR = "cccccccc-3333-4000-8000-000000000020";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-roles" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${token(roles)}`,
    "x-tenant-id": TENANT,
  };
}

const CONTACT_ID = "22222222-bbbb-4000-8000-000000000001";
const DEAL_ID = "33333333-cccc-4000-8000-000000000001";
const DEAL_ID_2 = "33333333-cccc-4000-8000-000000000002";

async function seedData(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
      VALUES (${CONTACT_ID}, ${TENANT}, 'Role Test Contact', 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
    await tx`
      INSERT INTO crm.deals (id, tenant_id, name, stage, value_minor, currency, status, version, created_at, updated_at, created_by, updated_by)
      VALUES
        (${DEAL_ID}, ${TENANT}, 'Test Deal 1', 'Proposal', 100000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR}),
        (${DEAL_ID_2}, ${TENANT}, 'Test Deal 2', 'Negotiation', 200000, 'INR', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
  });
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.contact_roles WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.deals WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.contacts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

beforeAll(async () => {
  await cleanup();
  await seedData();
});

describe("POST /v1/crm/contacts/:id/roles", () => {
  it("creates a role assignment (201)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/roles`,
      headers: headers(),
      payload: { dealId: DEAL_ID, role: "decision_maker" },
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.role).toBe("decision_maker");
    expect(body.data.contactId).toBe(CONTACT_ID);
    expect(body.data.dealId).toBe(DEAL_ID);
  });

  it("creates different roles on same deal", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/roles`,
      headers: headers(),
      payload: { dealId: DEAL_ID, role: "influencer" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.role).toBe("influencer");
  });

  it("creates a role on a second deal", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/roles`,
      headers: headers(),
      payload: { dealId: DEAL_ID_2, role: "champion" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
  });

  it("rejects invalid role value (400)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/roles`,
      headers: headers(),
      payload: { dealId: DEAL_ID, role: "invalid_role" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("rejects missing dealId (400)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/roles`,
      headers: headers(),
      payload: { role: "champion" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/roles`,
      payload: { dealId: DEAL_ID, role: "champion" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/roles`,
      headers: { authorization: `Bearer ${token(["citizen"])}`, "x-tenant-id": TENANT },
      payload: { dealId: DEAL_ID, role: "champion" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/contacts/:id/roles", () => {
  it("lists roles for a contact", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/contacts/${CONTACT_ID}/roles`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty array for contact with no roles", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/contacts/ffffffff-ffff-4000-8000-000000000001/roles`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});

describe("GET /v1/crm/deals/:id/stakeholders", () => {
  it("lists stakeholders on a deal", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/deals/${DEAL_ID}/stakeholders`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].contactId).toBe(CONTACT_ID);
  });

  it("returns empty for deal with no stakeholders", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/deals/ffffffff-ffff-4000-8000-000000000099/stakeholders`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });
});

describe("DELETE /v1/crm/contacts/:id/roles/:roleId", () => {
  it("deletes a role assignment (204)", async () => {
    const app = await buildApp();
    // Create a role to delete
    const createRes = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/roles`,
      headers: headers(),
      payload: { dealId: DEAL_ID, role: "end_user" },
    });
    const roleId = createRes.json().data.id;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/crm/contacts/${CONTACT_ID}/roles/${roleId}`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(204);
  });

  it("returns 404 for non-existent role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/crm/contacts/${CONTACT_ID}/roles/ffffffff-ffff-4000-8000-ffffffffffff`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});
