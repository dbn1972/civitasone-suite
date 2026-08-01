/**
 * TKT-04: Ticket Notes — Internal Notes vs Public Replies
 *
 * Tests for POST /v1/helpdesk/tickets/:id/notes and GET /v1/helpdesk/tickets/:id/notes
 * Also covers TKT-14: POST /v1/helpdesk/tickets/:id/reopen
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000088";
const TICKET_ID = "cccccccc-3333-4000-8000-000000000001";

function token(roles = ["helpdesk_user"], tenantId = TENANT) {
  return signToken({ sub: "user-001", tid: tenantId, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/helpdesk/tickets/:id/notes", () => {
  it("returns 202 for a public note", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_ID}/notes`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { content: "Hello customer", visibility: "public" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("returns 202 for an internal note with admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_ID}/notes`,
      headers: { authorization: `Bearer ${token(["helpdesk_admin"])}` },
      payload: { content: "Internal discussion", visibility: "internal" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("returns 403 for internal note with helpdesk_user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_ID}/notes`,
      headers: { authorization: `Bearer ${token(["helpdesk_user"])}` },
      payload: { content: "secret", visibility: "internal" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_ID}/notes`,
      payload: { content: "test", visibility: "public" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for empty content", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_ID}/notes`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { content: "", visibility: "public" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid visibility", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_ID}/notes`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { content: "test", visibility: "secret" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid ticket id param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/not-a-uuid/notes",
      headers: { authorization: `Bearer ${token()}` },
      payload: { content: "test", visibility: "public" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/helpdesk/tickets/:id/notes", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/tickets/${TICKET_ID}/notes`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/tickets/${TICKET_ID}/notes`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/tickets/${TICKET_ID}/notes`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /v1/helpdesk/tickets/:id/reopen (TKT-14)", () => {
  it("returns 202 with reason", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_ID}/reopen`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { reason: "Customer reported issue persists" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("returns 400 for empty reason", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_ID}/reopen`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { reason: "" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_ID}/reopen`,
      payload: { reason: "test" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
