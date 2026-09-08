/**
 * SAML config — DOM-005 regression tests.
 *
 * Before the fix, PUT /v1/identity/saml/config returned 202 "saved" without
 * writing anything, and GET echoed process.env vars instead of any stored
 * config. These tests assert a real round-trip: PUT persists, GET reads back
 * exactly what was saved (not an env-var fallback), and a second tenant never
 * sees tenant A's config.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// Fresh random tenant ids per run: the test DB is not reset between runs (see
// scripts/ci/bootstrap-postgres.sh — additive/idempotent by design), so a
// fixed tenant id here would accumulate rows/version across repeated runs
// and make "version === 1" style assertions flaky. Random ids give each run
// its own untouched tenant, mirroring the ctx()-with-randomUUID() pattern
// used in tests/apikeys-breakglass.db.test.ts.
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR = randomUUID();

function token(roles: string[], tid: string): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-saml-1" } as never, SECRET);
}
const headers = (roles: string[], tid: string) => ({ authorization: `Bearer ${token(roles, tid)}` });

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => { await app.close(); });

describe("SAML config — auth boundary", () => {
  it("PUT /v1/identity/saml/config → 401 without token", async () => {
    const res = await app.inject({ method: "PUT", url: "/v1/identity/saml/config", payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("PUT /v1/identity/saml/config → 403 for a non-admin role", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/identity/saml/config",
      headers: headers(["employee"], TENANT_A),
      payload: {
        entityId: "civitasone-test", acsUrl: "https://example.gov.in/acs",
        signRequests: true, nameIdFormat: "email",
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("SAML config — round trip (DOM-005)", () => {
  it("GET before any PUT honestly reports not configured, not env-var fallbacks", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/identity/saml/config",
      headers: headers(["identity_admin"], TENANT_B),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false });
  });

  it("PUT persists the config for real, and GET reads back exactly what was saved", async () => {
    const payload = {
      entityId: "civitasone-gov-in",
      acsUrl: "https://app.civitasone.in/api/auth/saml/acs",
      idpMetadataUrl: "https://idp.meripehchaan.gov.in/metadata.xml",
      signRequests: false,
      nameIdFormat: "persistent" as const,
    };
    const putRes = await app.inject({
      method: "PUT", url: "/v1/identity/saml/config",
      headers: headers(["identity_admin"], TENANT_A),
      payload,
    });
    // Honest success code — this used to be a fabricated 202 that persisted
    // nothing.
    expect(putRes.statusCode).toBe(200);
    const putBody = putRes.json();
    expect(putBody.entityId).toBe(payload.entityId);
    expect(putBody.acsUrl).toBe(payload.acsUrl);
    expect(putBody.idpMetadataUrl).toBe(payload.idpMetadataUrl);
    expect(putBody.signRequests).toBe(false);
    expect(putBody.nameIdFormat).toBe("persistent");
    expect(putBody.version).toBe(1);

    const getRes = await app.inject({
      method: "GET", url: "/v1/identity/saml/config",
      headers: headers(["identity_admin"], TENANT_A),
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json();
    expect(getBody.configured).toBe(true);
    expect(getBody.entityId).toBe(payload.entityId);
    expect(getBody.acsUrl).toBe(payload.acsUrl);
    expect(getBody.idpMetadataUrl).toBe(payload.idpMetadataUrl);
    expect(getBody.signRequests).toBe(false);
    expect(getBody.nameIdFormat).toBe("persistent");
  });

  it("a second PUT updates the same tenant row (version bumps) rather than creating a duplicate", async () => {
    const first = await app.inject({
      method: "PUT", url: "/v1/identity/saml/config",
      headers: headers(["identity_admin"], TENANT_A),
      payload: { entityId: "v1-entity", acsUrl: "https://example.gov.in/acs-v1", signRequests: true, nameIdFormat: "email" },
    });
    const v1 = first.json().version as number;

    const second = await app.inject({
      method: "PUT", url: "/v1/identity/saml/config",
      headers: headers(["identity_admin"], TENANT_A),
      payload: { entityId: "v2-entity", acsUrl: "https://example.gov.in/acs-v2", signRequests: true, nameIdFormat: "email" },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().version).toBe(v1 + 1);

    const getRes = await app.inject({
      method: "GET", url: "/v1/identity/saml/config",
      headers: headers(["identity_admin"], TENANT_A),
    });
    // GET reflects the latest write only — no duplicate row left behind.
    expect(getRes.json().entityId).toBe("v2-entity");
  });

  it("tenant B never sees tenant A's saved config (tenant isolation)", async () => {
    await app.inject({
      method: "PUT", url: "/v1/identity/saml/config",
      headers: headers(["identity_admin"], TENANT_A),
      payload: { entityId: "tenant-a-only", acsUrl: "https://example.gov.in/acs-a", signRequests: true, nameIdFormat: "email" },
    });
    const res = await app.inject({
      method: "GET", url: "/v1/identity/saml/config",
      headers: headers(["identity_admin"], TENANT_B),
    });
    expect(res.statusCode).toBe(200);
    // TENANT_B never PUTs its own config anywhere in this file, so it must
    // still read as unconfigured — never tenant A's row (RLS + tenant_id
    // WHERE clause both scope the read).
    expect(res.json()).toEqual({ configured: false });
  });
});
