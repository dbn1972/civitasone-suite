/**
 * MFA routes — route inject tests.
 *
 * Covers: POST /identity/mfa/setup, POST /identity/mfa/verify,
 *         POST /identity/users/:id/mfa
 *
 * Auth boundary, validation, error paths.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "a0000000-0000-4000-8000-0000000000aa";

function token(roles: string[] = ["super_admin"], tid = TENANT, sub = ACTOR): string {
  return signToken({ sub, tid, roles, sid: "sess-1" } as never, SECRET);
}
const headers = (roles?: string[], tid?: string, sub?: string) => ({
  authorization: `Bearer ${token(roles, tid, sub)}`,
});

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => { await app.close(); });

describe("MFA — auth boundary", () => {
  it("POST /identity/mfa/setup → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/identity/mfa/setup", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("POST /identity/mfa/verify → 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/mfa/verify",
      payload: { code: "123456" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /identity/users/:id/mfa → 401 without token", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/identity/users/${ACTOR}/mfa`,
      payload: { method: "totp" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /identity/users/:id/mfa → 403 for employee on another user", async () => {
    const otherId = "b9999999-9999-4000-8000-000000000099";
    const res = await app.inject({
      method: "POST",
      url: `/identity/users/${otherId}/mfa`,
      headers: headers(["employee"]),
      payload: { method: "totp" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("MFA — validation (400)", () => {
  it("POST /identity/mfa/verify with non-6-digit code → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/mfa/verify",
      headers: headers(["super_admin"]),
      payload: { code: "12345" }, // 5 digits
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("POST /identity/mfa/verify with letters → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/mfa/verify",
      headers: headers(["super_admin"]),
      payload: { code: "abcdef" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("MFA — setup", () => {
  it("POST /identity/mfa/setup → 201 with secret and provisioning URI", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/mfa/setup",
      headers: headers(["super_admin"]),
      payload: { method: "totp" },
    });
    // May be 201 (first setup) or 409 (already enabled from prior test run)
    if (res.statusCode === 201) {
      const body = res.json();
      expect(body.data.method).toBe("totp");
      expect(body.data.secret).toBeDefined();
      expect(body.data.secret.length).toBeGreaterThan(0);
      expect(body.data.provisioning_uri).toContain("otpauth://totp/");
      expect(body.data.provisioning_uri).toContain(ACTOR);
    } else {
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("ALREADY_ENABLED");
    }
  });

  it("POST /identity/mfa/setup with empty body defaults to totp → 201 or 409", async () => {
    // use a different actor to get a fresh setup
    const freshActor = "c0000000-0000-4000-8000-0000000000cc";
    const res = await app.inject({
      method: "POST", url: "/identity/mfa/setup",
      headers: headers(["super_admin"], TENANT, freshActor),
      payload: {},
    });
    expect([201, 409]).toContain(res.statusCode);
  });
});

describe("MFA — verify error paths", () => {
  it("POST /identity/mfa/verify → 404 when MFA not set up", async () => {
    const noMfaActor = "d0000000-0000-4000-8000-000000000ddd";
    const res = await app.inject({
      method: "POST", url: "/identity/mfa/verify",
      headers: headers(["super_admin"], TENANT, noMfaActor),
      payload: { code: "123456" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("POST /identity/mfa/verify → 401 with wrong code (after setup)", async () => {
    const testActor = "e0000000-0000-4000-8000-000000000eee";
    // Setup first
    const setup = await app.inject({
      method: "POST", url: "/identity/mfa/setup",
      headers: headers(["super_admin"], TENANT, testActor),
      payload: { method: "totp" },
    });
    if (setup.statusCode === 201) {
      // Now verify with a wrong code
      const res = await app.inject({
        method: "POST", url: "/identity/mfa/verify",
        headers: headers(["super_admin"], TENANT, testActor),
        payload: { code: "000000" },
      });
      expect([401, 429]).toContain(res.statusCode);
      if (res.statusCode === 401) {
        expect(res.json().code).toBe("INVALID_CODE");
      }
    }
  });
});
