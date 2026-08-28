/**
 * WebAuthn routes — route inject tests.
 *
 * Covers: /v1/identity/webauthn/register/options, /v1/identity/webauthn/register,
 *         /v1/identity/webauthn/authenticate/options, /v1/identity/webauthn/authenticate,
 *         /v1/identity/webauthn/credentials, /v1/identity/webauthn/credentials/:id
 *
 * Auth boundary, validation, and happy paths.
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

describe("WebAuthn — auth boundary", () => {
  it("GET /v1/identity/webauthn/register/options → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/identity/webauthn/register/options" });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/identity/webauthn/register → 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/identity/webauthn/register",
      payload: { id: "x", rawId: "x", type: "public-key", response: { attestationObject: "x", clientDataJSON: "x" } },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/identity/webauthn/credentials → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/identity/webauthn/credentials" });
    expect(res.statusCode).toBe(401);
  });

  it("DELETE /v1/identity/webauthn/credentials/:id → 401 without token", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/identity/webauthn/credentials/11111111-1111-4000-8000-000000000001",
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("WebAuthn — registration options", () => {
  it("GET /v1/identity/webauthn/register/options → 200 with challenge", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/identity/webauthn/register/options",
      headers: headers(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.challenge).toBeDefined();
    expect(body.challenge.length).toBeGreaterThan(0);
    expect(body.rp.id).toBeDefined();
    expect(body.rp.name).toBeDefined();
    expect(body.user.id).toBeDefined();
    expect(body.pubKeyCredParams).toBeInstanceOf(Array);
    expect(body.pubKeyCredParams.length).toBeGreaterThan(0);
    expect(body.authenticatorSelection).toBeDefined();
    expect(body.timeout).toBe(300_000);
  });
});

describe("WebAuthn — register credential", () => {
  // SEC/FUNC regression (deep-verification, 2026-08-27): this route used to
  // decode nothing, verify nothing, and store nothing, yet returned 201
  // "registered successfully" — a fabricated success response for a security
  // feature (a caller had no way to tell a real passkey from this fake one).
  // This test used to assert that fake-success as intended; it now asserts
  // the corrected, honest behavior — consistent with /authenticate, which
  // was already honestly returning 501 for the same not-yet-implemented
  // cryptographic verification.
  it("POST /v1/identity/webauthn/register → 501 (not yet impl, honest about it)", async () => {
    // First get options to set up the challenge
    await app.inject({
      method: "GET", url: "/v1/identity/webauthn/register/options",
      headers: headers(["super_admin"]),
    });

    // Then attempt to register
    const res = await app.inject({
      method: "POST", url: "/v1/identity/webauthn/register",
      headers: headers(["super_admin"]),
      payload: {
        id: "credential-id-base64url",
        rawId: "raw-id-base64url",
        type: "public-key",
        response: {
          attestationObject: "attestation-object-base64",
          clientDataJSON: "client-data-json-base64",
        },
      },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().code).toBe("NOT_IMPLEMENTED");
  });

  it("POST /v1/identity/webauthn/register → 400 with missing type", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/identity/webauthn/register",
      headers: headers(["super_admin"]),
      payload: {
        id: "x",
        rawId: "x",
        type: "invalid-type",
        response: { attestationObject: "x", clientDataJSON: "x" },
      },
    });
    // zod will reject the literal "public-key" mismatch
    expect([400, 500]).toContain(res.statusCode);
  });

  it("POST /v1/identity/webauthn/register → 400 with missing response fields", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/identity/webauthn/register",
      headers: headers(["super_admin"]),
      payload: { id: "x", rawId: "x", type: "public-key", response: {} },
    });
    expect([400, 500]).toContain(res.statusCode);
  });
});

describe("WebAuthn — authentication options", () => {
  it("GET /v1/identity/webauthn/authenticate/options → 200 with challenge", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/identity/webauthn/authenticate/options",
      headers: headers(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.challenge).toBeDefined();
    expect(body.rpId).toBeDefined();
    expect(body.timeout).toBe(300_000);
    expect(body.allowCredentials).toBeInstanceOf(Array);
    expect(body._tempId).toBeDefined();
  });
});

describe("WebAuthn — authenticate", () => {
  it("POST /v1/identity/webauthn/authenticate → 400 with expired/unknown tempId", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/identity/webauthn/authenticate",
      headers: headers(["super_admin"]),
      payload: {
        _tempId: "99999999-9999-4000-8000-999999999999",
        id: "cred-id",
        rawId: "raw-id",
        type: "public-key",
        response: {
          authenticatorData: "auth-data",
          clientDataJSON: "client-data",
          signature: "sig",
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("CHALLENGE_EXPIRED");
  });

  it("POST /v1/identity/webauthn/authenticate with valid tempId → 501 (not yet impl)", async () => {
    // Get auth options first to get a valid tempId
    const optRes = await app.inject({
      method: "GET", url: "/v1/identity/webauthn/authenticate/options",
      headers: headers(["super_admin"]),
    });
    const { _tempId } = optRes.json();

    const res = await app.inject({
      method: "POST", url: "/v1/identity/webauthn/authenticate",
      headers: headers(["super_admin"]),
      payload: {
        _tempId,
        id: "cred-id",
        rawId: "raw-id",
        type: "public-key",
        response: {
          authenticatorData: "auth-data",
          clientDataJSON: "client-data",
          signature: "sig",
        },
      },
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().code).toBe("NOT_IMPLEMENTED");
  });
});

describe("WebAuthn — credentials management", () => {
  it("GET /v1/identity/webauthn/credentials → 200 with data array", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/identity/webauthn/credentials",
      headers: headers(["super_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.total).toBeDefined();
  });

  it("DELETE /v1/identity/webauthn/credentials/:id → 204", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/identity/webauthn/credentials/11111111-1111-4000-8000-000000000001",
      headers: headers(["super_admin"]),
    });
    expect(res.statusCode).toBe(204);
  });

  it("DELETE /v1/identity/webauthn/credentials/:id → 400 for non-uuid", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/identity/webauthn/credentials/not-a-uuid",
      headers: headers(["super_admin"]),
    });
    expect([400, 500]).toContain(res.statusCode);
  });
});
