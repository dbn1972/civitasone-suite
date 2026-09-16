/**
 * COMP-007 -- policy-service `policies` module (policy documents: CRUD,
 * versions, publish/archive lifecycle, acknowledgment, compliance status)
 * smoke test.
 *
 * Registered as a route only (GET/POST/PATCH .../v1/policy/policies, plus
 * .../publish, .../archive, .../acknowledge, .../versions, and GET
 * .../v1/policy/compliance-status) but had zero test references anywhere in
 * the service.
 *
 * KNOWN ISSUE (found by this smoke test, not fixed here -- real migration
 * authoring is out of COMP-007's scope; matches the precedent set by this
 * campaign's own asset-service comp-007-asset-water-smoke.test.ts for
 * water-metering): `policies/schema.ts` declares
 * `pgSchema("policies").table("policies", ...)` (and the sibling
 * policy_versions / policy_acknowledgments tables), but NO migration under
 * services/policy-service/migrations/ -- and no file under
 * infra/db/bootstrap/ either -- ever creates a `policies` schema or any
 * table in it. Confirmed three ways: grepping every migration file in this
 * service (zero matches for "policies.policies" or a `policies` schema);
 * `\dn` against a freshly bootstrapped disposable Postgres lists
 * `_inbox, _outbox, abac, bindings, public, role_features, roles` -- no
 * `policies`; and a real request reproduces
 * `PostgresError: relation "policies.policies" does not exist` (code 42P01).
 * This service has hit exactly this bug class before -- see
 * migrations/0002b_missing_module_tables.sql's own header, which patched in
 * role_features's table after the identical "declared in Drizzle, no
 * migration ever created it" gap -- but no equivalent patch exists for
 * `policies`. The module (routes + full lifecycle, 276 LOC) is fully wired
 * into app.ts and looks complete; every request that reaches the database
 * 500s. This is very likely why it had zero tests: it has never been
 * possible to write one that passes end-to-end for the actual CRUD/lifecycle
 * behavior. The tests below assert what genuinely works today (the
 * auth/role/validation layer, which runs entirely before any DB access) and
 * document the DB-touching gap as KNOWN ISSUE tests, rather than hiding it
 * behind assertions that would only pass once someone else's migration PR
 * lands.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();

function token(roles: string[]) {
  return signToken({ sub: randomUUID(), tid: TENANT, roles, sid: "sess-comp007-policies" }, SECRET);
}

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("COMP-007: policies -- auth/validation layer (runs before any DB access, and works today)", () => {
  it("returns 401 without a token (list)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/policy/policies" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a non-admin role (create)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/policy/policies",
      headers: { authorization: `Bearer ${token(["staff"])}` },
      payload: { title: "IT Usage Policy", slug: "it-usage-policy" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for a non-admin role (patch / publish / archive / compliance-status)", async () => {
    const id = randomUUID();
    for (const [method, url] of [
      ["PATCH", `/v1/policy/policies/${id}`],
      ["POST", `/v1/policy/policies/${id}/publish`],
      ["POST", `/v1/policy/policies/${id}/archive`],
      ["GET", "/v1/policy/compliance-status"],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${token(["staff"])}` },
        payload: method === "PATCH" ? { title: "x" } : undefined,
      });
      // Role check runs before the id/body is ever parsed or the DB is
      // touched, so this is 403 even for a nonexistent id / no body.
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it("rejects a slug that fails the lowercase-kebab-case validator (400, before any DB access)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/policy/policies",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
      payload: { title: "Bad Slug", slug: "Not A Valid Slug!" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("acknowledge has no requireRole -- any authenticated role reaches the DB layer (proven by getting the SAME known-issue 500, not a 403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/policy/policies/${randomUUID()}/acknowledge`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    expect(res.statusCode).toBe(500);
  });
});

describe("COMP-007: policies -- KNOWN ISSUE: the `policies` schema was never migrated (see file header)", () => {
  it("create 500s for an authorized admin with an otherwise-valid payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/policy/policies",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
      payload: { title: "IT Usage Policy", slug: `it-usage-${randomUUID().slice(0, 8)}`, content: "v1" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toContain('relation "policies.policies" does not exist');
  });

  it("list 500s even though it has no role gate", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/policy/policies",
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    expect(res.statusCode).toBe(500);
  });

  it("get-by-id and versions both 500 the same way", async () => {
    const id = randomUUID();
    for (const url of [`/v1/policy/policies/${id}`, `/v1/policy/policies/${id}/versions`]) {
      const res = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${token(["citizen"])}` },
      });
      expect(res.statusCode, url).toBe(500);
    }
  });

  it("compliance-status 500s for an authorized admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/policy/compliance-status",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` },
    });
    expect(res.statusCode).toBe(500);
  });
});
