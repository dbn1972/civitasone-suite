/**
 * Helpdesk Service — Tickets Routes: RBAC + Validation API tests.
 *
 * Tests authentication (401), authorization (403), validation (400),
 * not-found (404), and happy-path (202) for ticket endpoints.
 *
 * Source: modules/tickets/routes.ts, modules/tickets/validators.ts
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "bb110001-1111-4000-8000-000000hd0001";
const ACTOR = "bb11aaaa-1111-4000-8000-000000hd000a";
const UNKNOWN_ID = "bb119999-1111-4000-8000-000000000099";

function token(roles: string[], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-hd" }, SECRET, 3600);
}
const hdUserBearer = () => ({ authorization: `Bearer ${token(["helpdesk_user"])}` });
const hdAdminBearer = () => ({ authorization: `Bearer ${token(["helpdesk_admin"])}` });
const unrelatedBearer = () => ({ authorization: `Bearer ${token(["finance_officer"])}` });

const validTicket = { subject: "Cannot access email" };

afterAll(async () => { await sqlClient.end(); });

// ═══ Authentication ═══

describe("POST /v1/helpdesk/tickets — authentication", () => {
  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/helpdesk/tickets", payload: validTicket });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ═══ RBAC ═══

describe("POST /v1/helpdesk/tickets — RBAC", () => {
  it("202 for helpdesk_user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: hdUserBearer(), payload: validTicket,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("202 for helpdesk_admin role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: hdAdminBearer(), payload: validTicket,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("403 for unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: unrelatedBearer(), payload: validTicket,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/helpdesk/tickets/:id/assign — admin-only RBAC", () => {
  it("403 for helpdesk_user (only admin can assign)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/helpdesk/tickets/${UNKNOWN_ID}/assign`,
      headers: hdUserBearer(), payload: { assigneeId: ACTOR },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/helpdesk/tickets/${UNKNOWN_ID}/assign`,
      payload: { assigneeId: ACTOR },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ═══ Validation (400) ═══

describe("POST /v1/helpdesk/tickets — validation", () => {
  it("400 for missing subject", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: hdUserBearer(), payload: { description: "Some issue" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("400 for empty subject", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: hdUserBearer(), payload: { subject: "" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for invalid priority enum", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: hdUserBearer(), payload: { subject: "X", priority: "Urgent" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for invalid ticketType enum", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: hdUserBearer(), payload: { subject: "X", ticketType: "request" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for non-UUID assetIds", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: hdUserBearer(), payload: { subject: "X", assetIds: ["bad-id"] },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for invalid channel", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: hdUserBearer(), payload: { subject: "X", channel: "telegram" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("202 with valid optional fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets",
      headers: hdAdminBearer(),
      payload: {
        subject: "Server Down",
        priority: "High",
        channel: "phone",
        description: "Production server is unresponsive",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });
});

describe("POST /v1/helpdesk/tickets/:id/assign — validation", () => {
  it("400 for non-UUID id param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/helpdesk/tickets/not-uuid/assign",
      headers: hdAdminBearer(), payload: { assigneeId: ACTOR },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for non-UUID assigneeId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/helpdesk/tickets/${UNKNOWN_ID}/assign`,
      headers: hdAdminBearer(), payload: { assigneeId: "bad" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ═══ Not Found (404) ═══

describe("GET /v1/helpdesk/tickets/:id — not found", () => {
  it("404 for non-existent ticket", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/helpdesk/tickets/${UNKNOWN_ID}`,
      headers: hdUserBearer(),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("400 for non-UUID id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/helpdesk/tickets/bad-id",
      headers: hdUserBearer(),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
