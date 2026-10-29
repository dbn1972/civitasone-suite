/**
 * TKT-11: Saved Views — CRUD Tests
 *
 * GET    /v1/helpdesk/tickets/views     — list (direct read)
 * POST   /v1/helpdesk/tickets/views     — create (command → 202)
 * PATCH  /v1/helpdesk/tickets/views/:id — update (command → 202)
 * DELETE /v1/helpdesk/tickets/views/:id — delete (command → 202)
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000090";
const ACTOR = "cccccccc-3333-4000-8000-000000000090";
const VIEW_ID = "dddddddd-4444-4000-8000-000000000090";

function token(roles = ["helpdesk_admin"], tenantId = TENANT, sub = ACTOR) {
  return signToken({ sub, tid: tenantId, roles, sid: "sess-views" }, SECRET);
}

// UAT W6 P1: PATCH now reads the view before publishing, so the update test needs a
// real view row (owned by ACTOR in TENANT). Seeded here, removed afterwards.
async function inTenant(fn: (tx: Parameters<Parameters<typeof sqlClient.begin>[0]>[0]) => Promise<unknown>): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await fn(tx);
  });
}
beforeAll(async () => {
  await inTenant((tx) => tx`
    INSERT INTO helpdesk.saved_views (id, tenant_id, owner_id, name)
    VALUES (${VIEW_ID}, ${TENANT}, ${ACTOR}, 'TKT-11 fixture view')
    ON CONFLICT (id) DO NOTHING`);
});
afterAll(async () => {
  await inTenant((tx) => tx`DELETE FROM helpdesk.saved_views WHERE id = ${VIEW_ID} AND tenant_id = ${TENANT}`);
  await sqlClient.end();
});

describe("GET /v1/helpdesk/tickets/views (list)", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/tickets/views",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/tickets/views",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/helpdesk/tickets/views",
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/helpdesk/tickets/views (create)", () => {
  it("returns 202 with valid payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/views",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        name: "My Open Tickets",
        filters: { status: "open", priority: "high" },
        columns: ["id", "subject", "status", "priority", "assignee"],
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeDefined();
  });

  it("returns 202 with shared=true", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/views",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        name: "Team Escalated View",
        filters: { escalated: true },
        columns: ["id", "subject", "escalation_level"],
        shared: true,
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("returns 400 for empty name", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/views",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "", filters: {} },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/views",
      payload: { name: "test", filters: {} },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/views",
      headers: { authorization: `Bearer ${token(["citizen"])}` },
      payload: { name: "test", filters: {} },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("PATCH /v1/helpdesk/tickets/views/:id (update)", () => {
  it("returns 202 for valid update", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/tickets/views/${VIEW_ID}`,
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
      payload: { name: "Updated Name" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBe(VIEW_ID);
    expect(body.status).toBe("accepted");
  });

  it("returns 400 for invalid id param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/helpdesk/tickets/views/not-a-uuid",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Updated" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/tickets/views/${VIEW_ID}`,
      payload: { name: "Updated" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/helpdesk/tickets/views/${VIEW_ID}`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
      payload: { name: "x" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("DELETE /v1/helpdesk/tickets/views/:id (delete)", () => {
  it("returns 202 for valid delete command", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/helpdesk/tickets/views/${VIEW_ID}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBe(VIEW_ID);
    expect(body.status).toBe("accepted");
  });

  it("returns 400 for invalid id param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/helpdesk/tickets/views/not-uuid",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/helpdesk/tickets/views/${VIEW_ID}`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/helpdesk/tickets/views/${VIEW_ID}`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
