/**
 * TKT-09: Bulk Operations
 *
 * Tests for POST /v1/helpdesk/tickets/bulk
 * Validates max 50 tickets per batch, action types, auth, roles.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000088";

function token(roles = ["helpdesk_admin"], tenantId = TENANT) {
  return signToken({ sub: "user-001", tid: tenantId, roles, sid: "sess-001" }, SECRET);
}

function makeUuids(count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
  );
}

afterAll(async () => { await sqlClient.end(); });

describe("POST /v1/helpdesk/tickets/bulk", () => {
  it("returns 202 for valid bulk assign", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/bulk",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        ticketIds: makeUuids(3),
        action: "assign",
        payload: { assigneeId: "ffffffff-ffff-4000-8000-000000000001" },
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.batchId).toBeDefined();
    expect(body.ticketCount).toBe(3);
    expect(body.status).toBe("accepted");
  });

  it("returns 202 for bulk close", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/bulk",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        ticketIds: makeUuids(2),
        action: "close",
        payload: { reason: "Resolved by vendor" },
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("returns 202 for bulk set_priority", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/bulk",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        ticketIds: makeUuids(5),
        action: "set_priority",
        payload: { priority: "High" },
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().ticketCount).toBe(5);
  });

  it("returns 400 for more than 50 tickets", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/bulk",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        ticketIds: makeUuids(51),
        action: "close",
        payload: {},
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for empty ticketIds", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/bulk",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        ticketIds: [],
        action: "close",
        payload: {},
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid action", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/bulk",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        ticketIds: makeUuids(2),
        action: "delete",
        payload: {},
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/bulk",
      payload: {
        ticketIds: makeUuids(1),
        action: "close",
        payload: {},
      },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for helpdesk_user role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/bulk",
      headers: { authorization: `Bearer ${token(["helpdesk_user"])}` },
      payload: {
        ticketIds: makeUuids(2),
        action: "assign",
        payload: { assigneeId: "ffffffff-ffff-4000-8000-000000000001" },
      },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for non-uuid ticket ids", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/bulk",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        ticketIds: ["not-a-uuid", "also-bad"],
        action: "close",
        payload: {},
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("accepts max boundary of 50 tickets", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/helpdesk/tickets/bulk",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        ticketIds: makeUuids(50),
        action: "close",
        payload: {},
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().ticketCount).toBe(50);
  });
});
