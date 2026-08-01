/**
 * Teams, queues, ownership transfer, and workload tests (AS-002 + AS-003).
 * Tests CRUD for teams, transfer command, agent workload.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000050";
const ACTOR = "cccccccc-3333-4000-8000-000000000050";
const AGENT_ID = "dddddddd-4444-4000-8000-000000000050";

function token(roles = ["crm_admin"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-teams" }, SECRET);
}

function headers(roles = ["crm_admin"]) {
  return {
    authorization: `Bearer ${token(roles)}`,
    "x-tenant-id": TENANT,
  };
}

const CONTACT_ID = "66666666-ffff-4000-8000-000000000001";
const TRANSFER_TARGET = "77777777-aaaa-4000-8000-000000000001";

async function seedData(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, created_at, updated_at, created_by, updated_by)
      VALUES (${CONTACT_ID}, ${TENANT}, 'Transfer Test Contact', 'qualified', 'active', 1, now(), now(), ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
    await tx`
      INSERT INTO crm.agent_workload (id, tenant_id, agent_id, max_leads, current_load, available, skills)
      VALUES (gen_random_uuid(), ${TENANT}, ${AGENT_ID}, 50, 10, true, '["sales", "support"]'::jsonb)
      ON CONFLICT DO NOTHING
    `.catch(() => {});
  });
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.lead_queues WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.teams WHERE tenant_id = ${TENANT}`.catch(() => {});
    await tx`DELETE FROM crm.agent_workload WHERE tenant_id = ${TENANT}`.catch(() => {});
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

describe("POST /v1/crm/teams", () => {
  it("creates a team (201)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/teams",
      headers: headers(),
      payload: { name: "Sales Team Alpha", territory: { region: "North" } },
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.data.id).toBeDefined();
    expect(body.data.name).toBe("Sales Team Alpha");
    expect(body.data.territory).toEqual({ region: "North" });
  });

  it("creates team with empty territory", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/teams",
      headers: headers(),
      payload: { name: "Support Team Beta" },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    expect(res.json().data.territory).toEqual({});
  });

  it("rejects empty name → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/teams",
      headers: headers(),
      payload: { name: "" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/teams",
      payload: { name: "No Auth Team" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/crm/teams",
      headers: { authorization: `Bearer ${token(["crm_user"])}`, "x-tenant-id": TENANT },
      payload: { name: "Forbidden Team" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/teams", () => {
  it("lists teams for tenant", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/teams",
      headers: headers(["crm_user"]),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/teams",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/crm/contacts/:id/transfer", () => {
  it("publishes transfer command → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/transfer`,
      headers: headers(["crm_user"]),
      payload: { toOwnerId: TRANSFER_TARGET, reason: "Reassigning to specialist" },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("rejects missing reason → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/transfer`,
      headers: headers(["crm_user"]),
      payload: { toOwnerId: TRANSFER_TARGET },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("rejects invalid toOwnerId → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/transfer`,
      headers: headers(["crm_user"]),
      payload: { toOwnerId: "not-uuid", reason: "test" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/crm/contacts/${CONTACT_ID}/transfer`,
      payload: { toOwnerId: TRANSFER_TARGET, reason: "test" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/crm/teams/agents", () => {
  it("lists agents with workload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/teams/agents",
      headers: headers(["crm_user"]),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data[0].agentId).toBe(AGENT_ID);
    expect(body.data[0].maxLeads).toBe(50);
    expect(body.data[0].available).toBe(true);
  });
});

describe("PATCH /v1/crm/teams/agents/:agentId/capacity", () => {
  it("updates maxLeads → 200", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/teams/agents/${AGENT_ID}/capacity`,
      headers: headers(),
      payload: { maxLeads: 100 },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.maxLeads).toBe(100);
  });

  it("updates available status", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/teams/agents/${AGENT_ID}/capacity`,
      headers: headers(),
      payload: { available: false },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.available).toBe(false);
  });

  it("updates both maxLeads and available", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/teams/agents/${AGENT_ID}/capacity`,
      headers: headers(),
      payload: { maxLeads: 75, available: true },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("rejects with no fields → 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/teams/agents/${AGENT_ID}/capacity`,
      headers: headers(),
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 for non-existent agent", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/teams/agents/ffffffff-ffff-4000-8000-ffffffffffff/capacity`,
      headers: headers(),
      payload: { maxLeads: 50 },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for non-admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/teams/agents/${AGENT_ID}/capacity`,
      headers: { authorization: `Bearer ${token(["crm_user"])}`, "x-tenant-id": TENANT },
      payload: { maxLeads: 50 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
