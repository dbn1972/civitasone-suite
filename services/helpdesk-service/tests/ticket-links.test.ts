/**
 * TKT-08: Ticket Links — Parent/Child and Duplicate Linking
 *
 * Tests for POST/GET/DELETE /v1/helpdesk/tickets/:id/links
 * Also covers TKT-07: POST /v1/helpdesk/tickets/:id/transfer
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000088";
const TICKET_A = "cccccccc-3333-4000-8000-000000000001";
const TICKET_B = "cccccccc-3333-4000-8000-000000000002";
const LINK_ID = "dddddddd-4444-4000-8000-000000000001";

function token(roles = ["helpdesk_user"], tenantId = TENANT) {
  return signToken({ sub: "user-001", tid: tenantId, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/helpdesk/tickets/:id/links", () => {
  it("returns 202 for valid link creation", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/links`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { targetTicketId: TICKET_B, linkType: "parent" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
    expect(res.json().status).toBe("accepted");
  });

  it("returns 422 for self-link", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/links`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { targetTicketId: TICKET_A, linkType: "duplicate" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("SELF_LINK");
  });

  it("returns 400 for invalid linkType", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/links`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { targetTicketId: TICKET_B, linkType: "invalid" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid UUID params", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/bad-id/links",
      headers: { authorization: `Bearer ${token()}` },
      payload: { targetTicketId: TICKET_B, linkType: "child" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/links`,
      payload: { targetTicketId: TICKET_B, linkType: "related" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for wrong role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/links`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
      payload: { targetTicketId: TICKET_B, linkType: "related" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/helpdesk/tickets/:id/links", () => {
  it("returns 200 with data array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/tickets/${TICKET_A}/links`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/helpdesk/tickets/${TICKET_A}/links`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("DELETE /v1/helpdesk/tickets/:id/links/:linkId", () => {
  it("returns 204 for valid deletion", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/helpdesk/tickets/${TICKET_A}/links/${LINK_ID}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(204);
  });

  it("returns 400 for invalid linkId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/helpdesk/tickets/${TICKET_A}/links/not-uuid`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/helpdesk/tickets/:id/transfer (TKT-07)", () => {
  it("returns 202 for valid transfer", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/transfer`,
      headers: { authorization: `Bearer ${token(["helpdesk_admin"])}` },
      payload: { toDepartment: "Engineering", reason: "Technical issue" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("returns 403 for non-admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/transfer`,
      headers: { authorization: `Bearer ${token(["helpdesk_user"])}` },
      payload: { toDepartment: "Engineering", reason: "Technical issue" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for missing reason", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/helpdesk/tickets/${TICKET_A}/transfer`,
      headers: { authorization: `Bearer ${token(["helpdesk_admin"])}` },
      payload: { toDepartment: "Engineering" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
