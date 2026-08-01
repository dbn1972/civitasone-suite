/**
 * INT-04: Ticket-ID Correlation in Inbox Threading Tests
 * POST /v1/notification/inbox/:conversationId/correlate
 * GET /v1/notification/inbox/:conversationId/correlation
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000072";
const ACTOR = "cccccccc-3333-4000-8000-000000000072";
const CONV_ID = "dddddddd-4444-4000-8000-000000000072";
const TICKET_ID = "eeeeeeee-5555-4000-8000-000000000072";

function token(roles = ["helpdesk_admin"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-003" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/notification/inbox/:conversationId/correlate (INT-04)", () => {
  it("returns 202 with valid ticketId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/notification/inbox/${CONV_ID}/correlate`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { ticketId: TICKET_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeDefined();
  });

  it("returns 400 for invalid ticketId (not uuid)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/notification/inbox/${CONV_ID}/correlate`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { ticketId: "not-a-uuid" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid conversationId (not uuid)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/notification/inbox/bad-id/correlate",
      headers: { authorization: `Bearer ${token()}` },
      payload: { ticketId: TICKET_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing ticketId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/notification/inbox/${CONV_ID}/correlate`,
      headers: { authorization: `Bearer ${token()}` },
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/notification/inbox/${CONV_ID}/correlate`,
      payload: { ticketId: TICKET_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/notification/inbox/${CONV_ID}/correlate`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
      payload: { ticketId: TICKET_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/notification/inbox/:conversationId/correlation (INT-04)", () => {
  it("returns 404 when no correlation exists", async () => {
    const unknownConvId = "ffffffff-6666-4000-8000-000000000072";
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/notification/inbox/${unknownConvId}/correlation`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 401 without auth token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/notification/inbox/${CONV_ID}/correlation`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/notification/inbox/${CONV_ID}/correlation`,
      headers: { authorization: `Bearer ${token(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for invalid conversationId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/notification/inbox/not-valid-uuid/correlation",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
