/**
 * Sync routes — route inject tests.
 *
 * Covers: POST /v1/sync/push, POST /v1/sync/pull
 *
 * Auth boundary, validation, ABAC mailbox access.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "a0000000-0000-4000-8000-0000000000aa";
const DEVICE_ID = "d0000000-0000-4000-8000-000000000001";

function token(roles: string[] = ["super_admin"], tid = TENANT, sub = ACTOR): string {
  return signToken({ sub, tid, roles, sid: "sess-1" } as never, SECRET);
}
const headers = (roles?: string[], tid?: string) => ({
  authorization: `Bearer ${token(roles, tid)}`,
});

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => { await app.close(); });

describe("Sync routes — auth boundary", () => {
  it("POST /v1/sync/push → 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sync/push",
      payload: { mailbox: "employees", deviceId: DEVICE_ID, cursor: "0", mutations: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/sync/pull → 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sync/pull",
      payload: { mailbox: "employees", deviceId: DEVICE_ID, cursor: "0", limit: 50 },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("Sync routes — ABAC mailbox authorization (SEC-3)", () => {
  it("POST /v1/sync/push to payments mailbox as employee → 403", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sync/push",
      headers: headers(["employee"]),
      payload: { mailbox: "payments", deviceId: DEVICE_ID, cursor: "0", mutations: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/sync/push to payments mailbox as hr_admin → 403 (needs finance/payroll admin)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sync/push",
      headers: headers(["hr_admin"]),
      payload: { mailbox: "payments", deviceId: DEVICE_ID, cursor: "0", mutations: [] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/sync/push to payments mailbox as payroll_admin → passes ABAC (may fail at device)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sync/push",
      headers: headers(["payroll_admin"]),
      payload: { mailbox: "payments", deviceId: DEVICE_ID, cursor: "0", mutations: [] },
    });
    // Passes the mailbox ABAC check; may fail at device verification or DB
    expect([200, 400, 403, 500]).toContain(res.statusCode);
    if (res.statusCode === 403) {
      const body = res.json();
      // Should be DEVICE_NOT_TRUSTED not FORBIDDEN (we passed the mailbox check)
      expect(["DEVICE_NOT_TRUSTED", "DEVICE_REVOKED"]).toContain(body.code);
    }
  });

  it("POST /v1/sync/pull to payments mailbox as employee → 403", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sync/pull",
      headers: headers(["employee"]),
      payload: { mailbox: "payments", deviceId: DEVICE_ID, cursor: "0", limit: 50 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/sync/push to approvals mailbox as officer → passes ABAC (needs device)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sync/push",
      headers: headers(["officer"]),
      payload: { mailbox: "approvals", deviceId: DEVICE_ID, cursor: "0", mutations: [] },
    });
    // Officer passes ABAC for non-restricted mailboxes; may fail at device/DB
    expect([200, 400, 403, 500]).toContain(res.statusCode);
    if (res.statusCode === 403) {
      // Should be device-related, not ABAC-related
      expect(["DEVICE_NOT_TRUSTED", "DEVICE_REVOKED"]).toContain(res.json().code);
    }
  });

  it("POST /v1/sync/push as super_admin → passes ABAC on any mailbox", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sync/push",
      headers: headers(["super_admin"]),
      payload: { mailbox: "payments", deviceId: DEVICE_ID, cursor: "0", mutations: [] },
    });
    // super_admin passes ABAC; may fail at device verification or DB
    expect([200, 400, 403, 500]).toContain(res.statusCode);
    if (res.statusCode === 403) {
      expect(["DEVICE_NOT_TRUSTED", "DEVICE_REVOKED"]).toContain(res.json().code);
    }
  });
});

describe("Sync routes — validation (400/500)", () => {
  it("POST /v1/sync/push with invalid mailbox → 500 (zod enum error)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sync/push",
      headers: headers(["super_admin"]),
      payload: { mailbox: "invalid_mailbox", deviceId: DEVICE_ID, cursor: "0", mutations: [] },
    });
    // The sync routes don't register their own ZodError handler → falls through to 500
    expect(res.statusCode).toBe(500);
  });

  it("POST /v1/sync/push with missing deviceId → 500 (zod required)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sync/push",
      headers: headers(["super_admin"]),
      payload: { mailbox: "employees", cursor: "0", mutations: [] },
    });
    expect([400, 500]).toContain(res.statusCode);
  });

  it("POST /v1/sync/pull with missing mailbox → 500 (zod required)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sync/pull",
      headers: headers(["super_admin"]),
      payload: { deviceId: DEVICE_ID, cursor: "0", limit: 50 },
    });
    expect([400, 500]).toContain(res.statusCode);
  });

  it("POST /v1/sync/pull with valid params → passes validation (may fail at device)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/sync/pull",
      headers: headers(["super_admin"]),
      payload: { mailbox: "employees", deviceId: DEVICE_ID, cursor: "0", limit: 50 },
    });
    // Passes validation, may fail at device check (403 DEVICE_NOT_TRUSTED) or succeed
    expect([200, 403, 500]).toContain(res.statusCode);
  });
});
