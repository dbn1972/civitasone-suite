/**
 * UAT W5-C (API sweep 2026-10-29 + FQ12 #68): identity-service request-validation and SCIM boundary.
 *
 * 1. Every row below answered 500 because app.ts registered the shared schema error handler AFTER the
 *    route plugins: encapsulated contexts copy the parent handler when created, so a ZodError thrown in
 *    a module without its own handler reached Fastify's default handler -> 500. Each must now be a 400.
 * 2. SCIM /Users accepts the per-tenant SCIM bearer (not a JWT) and application/scim+json, and reads
 *    are scoped to the token's tenant regardless of any client-supplied tenant hint.
 *
 * Real Postgres (DATABASE_URL), memory queue/cache -- see vitest.config.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { users } from "../src/modules/users/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const SCIM_TOKEN = process.env.SCIM_BEARER_TOKEN as string; // bound to SCIM_TENANT_ID by bootstrapLegacyScimToken
const SCIM_TENANT = process.env.SCIM_TENANT_ID as string;
const T = "c5c5c5c5-0000-4000-8000-000000000001";
const OTHER_TENANT = "c5c5c5c5-0000-4000-8000-000000000002";
const ACTOR = "c5c5c5c5-0000-4000-8000-0000000000aa";
const SCIM_USER = "c5c5c5c5-0000-4000-8000-0000000000b1";

const jwt = (roles: string[], tid = T) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "c5c5c5c5-0000-4000-8000-0000000000cc" } as never, SECRET, 3600)}`,
});
const ADMIN = jwt(["super_admin", "tenant_admin", "platform_admin", "identity_admin"]);

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(SCIM_TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(users)
        .values({ id: SCIM_USER, tenantId: SCIM_TENANT, email: "w5c-scim-user@dept.gov.in", name: "W5C Scim User", status: "active", createdBy: ACTOR, updatedBy: ACTOR })
        .onConflictDoNothing();
    }),
  );
});

afterAll(async () => {
  await runWithTenant(SCIM_TENANT, () => db.transaction(async (tx) => {
    await tx.delete(users).where(eq(users.id, SCIM_USER));
  })).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describe("UAT sweep: validation failures are 400, not 500", () => {
  const cases: Array<{ name: string; method: "GET" | "POST" | "PUT" | "DELETE"; url: string; payload?: unknown }> = [
    { name: "POST /identity/sessions empty body", method: "POST", url: "/identity/sessions", payload: {} },
    { name: "DELETE /identity/sessions/:id malformed id", method: "DELETE", url: "/identity/sessions/not-a-uuid" },
    { name: "GET /identity/sessions/:id malformed id", method: "GET", url: "/identity/sessions/not-a-uuid" },
    { name: "GET /identity/sessions bad query", method: "GET", url: "/identity/sessions?limit=not-a-number" },
    { name: "POST /v1/devices/register empty body", method: "POST", url: "/v1/devices/register", payload: {} },
    { name: "POST /v1/devices/step-up empty body", method: "POST", url: "/v1/devices/step-up", payload: {} },
    { name: "POST /v1/sync/push empty body", method: "POST", url: "/v1/sync/push", payload: {} },
    { name: "POST /v1/sync/pull empty body", method: "POST", url: "/v1/sync/pull", payload: {} },
    { name: "PUT /v1/identity/saml/config empty body", method: "PUT", url: "/v1/identity/saml/config", payload: {} },
    { name: "POST /identity/scim-tokens empty body", method: "POST", url: "/identity/scim-tokens", payload: {} },
    { name: "POST /v1/identity/webauthn/register empty body", method: "POST", url: "/v1/identity/webauthn/register", payload: {} },
    { name: "POST /v1/identity/webauthn/authenticate empty body", method: "POST", url: "/v1/identity/webauthn/authenticate", payload: {} },
  ];

  for (const c of cases) {
    it(`${c.name} -> 400`, async () => {
      const res = await app.inject({ method: c.method, url: c.url, headers: ADMIN, ...(c.payload !== undefined ? { payload: c.payload as object } : {}) });
      expect(res.statusCode, res.body).toBe(400);
    });
  }

  it("a module with its own error handler (rbac) still answers malformed JSON with 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/identity/rbac/roles", headers: { ...ADMIN, "content-type": "application/json" }, payload: "{not json",
    });
    expect(res.statusCode, res.body).toBe(400);
  });
});

describe("FQ12 #68: SCIM bearer + application/scim+json", () => {
  const scimHeaders = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${SCIM_TOKEN}`, ...extra });

  it("POST /Users with the SCIM bearer and application/scim+json is accepted (was 401 / 415)", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/identity/scim/Users",
      headers: scimHeaders({ "content-type": "application/scim+json" }),
      payload: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: `w5c-${randomUUID().slice(0, 8)}@dept.gov.in`,
        name: { givenName: "Scim", familyName: "Created" },
      }),
    });
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json().schemas).toContain("urn:ietf:params:scim:schemas:core:2.0:User");
  });

  it("malformed application/scim+json is a 400, not a 500", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/identity/scim/Users",
      headers: scimHeaders({ "content-type": "application/scim+json" }), payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
  });

  it("the SCIM routes still refuse a missing, unknown or JWT bearer", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/identity/scim/Users" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/identity/scim/Users", headers: { authorization: "Bearer not-a-real-scim-token" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/identity/scim/Users", headers: ADMIN })).statusCode).toBe(401);
    expect((await app.inject({
      method: "POST", url: "/v1/identity/scim/Users", headers: { "content-type": "application/scim+json" },
      payload: JSON.stringify({ userName: "nobody@dept.gov.in" }),
    })).statusCode).toBe(401);
  });

  it("reads are scoped to the token's tenant, whatever tenant the client hints", async () => {
    for (const url of ["/v1/identity/scim/Users", `/v1/identity/scim/Users?tenantId=${OTHER_TENANT}`]) {
      const res = await app.inject({ method: "GET", url, headers: scimHeaders({ "x-tenant-id": OTHER_TENANT }) });
      expect(res.statusCode, res.body).toBe(200);
      const ids = (res.json().Resources as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toContain(SCIM_USER);
    }
    const one = await app.inject({ method: "GET", url: `/v1/identity/scim/Users/${SCIM_USER}?tenantId=${OTHER_TENANT}`, headers: scimHeaders() });
    expect(one.statusCode, one.body).toBe(200);
    expect(one.json().id).toBe(SCIM_USER);
  });

  it("the SCIM rate limit cannot be reset by changing ?tenantId (review #2380)", async () => {
    // Off-loopback peer: the shared limiter allow-lists 127.0.0.1, the default inject address.
    const remoteAddress = "203.0.113.77";
    const hit = (qs = "") => app.inject({ method: "GET", url: `/v1/identity/scim/Users${qs}`, remoteAddress });
    for (let i = 0; i < 300; i++) expect((await hit()).statusCode).toBe(401); // no bearer: refused, but counted
    expect((await hit()).statusCode).toBe(429);
    expect((await hit(`?tenantId=${randomUUID()}`)).statusCode).toBe(429);
    expect((await hit(`?tenantId=${OTHER_TENANT}`)).statusCode).toBe(429);
    // another client is unaffected
    expect((await app.inject({ method: "GET", url: "/v1/identity/scim/Users", remoteAddress: "203.0.113.78" })).statusCode).toBe(401);
  });

  it("a malformed SCIM user id is a 400, not a 500", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/identity/scim/Users/not-a-uuid", headers: scimHeaders() });
    expect(res.statusCode).toBe(400);
  });
});
