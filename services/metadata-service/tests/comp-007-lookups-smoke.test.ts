/**
 * COMP-007 -- metadata-service `lookups` module (KV store, lookup tables +
 * values, enums, schema catalog, generic entity metadata) smoke test.
 *
 * Registered as a route only (app.ts, dynamic import) but had zero test
 * references anywhere in the service.
 *
 * REAL BUG (found while writing this test, not fixed here -- see PR
 * description): the ENTIRE module is non-functional against a real database.
 * `schema.ts` declares four tables in the `metadata` Postgres schema --
 * `kv_store`, `lookup_tables`, `lookup_values`, `enum_definitions` -- but NO
 * migration anywhere in the repo creates any of them (confirmed by grepping
 * every `*.sql` file in the repository, not just this service's own
 * migrations/ directory). Confirmed live against a real disposable Postgres
 * bootstrapped via this repo's own scripts/ci/bootstrap-postgres.sh: `\dn`
 * shows the `metadata` schema exists, and `\dt metadata.*` lists the 12
 * tables the OTHER metadata-service modules (entities, fields, layouts,
 * forms, numbering, etc.) own -- all real -- but none of this module's four.
 * Every route below that reaches the database 500s on every real request,
 * for every tenant, with a literal `relation "metadata.<table>" does not
 * exist` error. This is the same bug CLASS already disclosed (not fixed) for
 * `tenant-service/tenant-extensions` (COMP-007 tranche 2) and
 * `policy-service/policies` (also tranche 2) -- adding the missing migration
 * is a real schema/ops change outside this gap's "add tests" DoD, so it is
 * disclosed here, not fixed, matching that exact precedent.
 *
 * Routes gated by auth/validation that fail BEFORE ever reaching the database
 * (401 with no token, 403 for a role outside the ACL, 400 for input that
 * fails `safeParse()`) work correctly today and are asserted as passing,
 * real behavior below -- only the DB-touching paths are broken.
 *
 * Also shares config module's disclosed error-handling gap (see
 * comp-007-config-smoke.test.ts's file header for the full root-cause
 * writeup: neither `config` nor `lookups` registers a local Fastify error
 * handler, so the service-level fallback -- confirmed dead for every route in
 * this app -- never converts an unhandled error into the service's normal
 * `{code, message, correlationId}` envelope). This module happens to shield
 * itself from the ZodError half of that gap already: every route funnels
 * validation through a local `safeParse()` helper that calls zod's
 * `.safeParse()` (never throws) and converts a failure into a thrown
 * `HttpError(400, "VALIDATION_FAILED", ...)` directly -- confirmed below, a
 * real 400. But the missing-migration 500s below are a DIFFERENT error
 * (Postgres `relation does not exist`, not a ZodError) and are NOT
 * HttpError-shaped either, so they still fall through to Fastify's bare
 * built-in default -- a generic 500, not even the `VALIDATION_FAILED`-style
 * envelope.
 *
 * Two write routes (POST /kv, POST /:entityType/:entityId) carry their own
 * pre-existing "Deep-verify audit" comments noting a PRIOR fix already closed
 * a missing-ADMIN-check gap on both -- current code already has
 * requireRole(ctx, ADMIN) on both, confirmed by reading routes.ts; nothing
 * left to do there.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function token(roles: string[], tid: string) {
  return signToken({ sub: randomUUID(), tid, roles, sid: "sess-comp007-lookups" }, SECRET);
}
function authHeaders(roles: string[], tid: string) {
  return { authorization: `Bearer ${token(roles, tid)}` };
}

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("COMP-007: lookups -- auth/validation gates that fail BEFORE reaching the (broken) database", () => {
  it("GET /v1/metadata/kv returns 401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/metadata/kv" });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/metadata/kv requires ADMIN (403 for a plain staff role, before any DB access)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/metadata/kv",
      headers: authHeaders(["staff"], tid),
      payload: { k: "theme", v: { color: "blue" } },
    });
    expect(res.statusCode).toBe(403);
  });

  it("real 400 (not 500) for invalid input -- confirms the local safeParse() defense works independently of the DB", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/metadata/kv",
      headers: authHeaders(["tenant_admin"], tid),
      payload: { k: "", v: "x" }, // k fails min(1)
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST generic entity metadata requires ADMIN (403 for a plain staff role, before any DB access)", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: `/v1/metadata/trade_license/${randomUUID()}`,
      headers: authHeaders(["staff"], tid),
      payload: { k: "x", v: "y" },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("COMP-007: lookups -- KNOWN ISSUE (see file header): every DB-touching route 500s, real Postgres error confirmed", () => {
  it("GET /v1/metadata/kv: real Postgres 'relation does not exist' for metadata.kv_store", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: "/v1/metadata/kv",
      headers: authHeaders(["staff"], tid),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toContain('relation "metadata.kv_store" does not exist');
  });

  it("POST /v1/metadata/kv (authorized, valid body): same table, same 500", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/metadata/kv",
      headers: authHeaders(["tenant_admin"], tid),
      payload: { ns: "prefs", k: "theme", v: { color: "blue" } },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toContain('relation "metadata.kv_store" does not exist');
  });

  it("GET /v1/metadata/lookups: real Postgres 'relation does not exist' for metadata.lookup_tables", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: "/v1/metadata/lookups",
      headers: authHeaders(["staff"], tid),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toContain('relation "metadata.lookup_tables" does not exist');
  });

  it("POST /v1/metadata/lookups (authorized, valid body): same table, same 500 -- no lookup table can ever be created", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/metadata/lookups",
      headers: authHeaders(["tenant_admin"], tid),
      payload: { code: "ward_types", label: "Ward Types" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toContain('relation "metadata.lookup_tables" does not exist');
  });

  it("GET /v1/metadata/lookups/:code: 500, not the 404 a real 'not found' would be -- the SELECT itself fails, it never gets to say 'no such row'", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: "/v1/metadata/lookups/anything",
      headers: authHeaders(["staff"], tid),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toContain('relation "metadata.lookup_tables" does not exist');
  });

  it("GET /v1/metadata/enums/:name: real Postgres 'relation does not exist' for metadata.enum_definitions", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: "/v1/metadata/enums/anything",
      headers: authHeaders(["staff"], tid),
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toContain('relation "metadata.enum_definitions" does not exist');
  });

  it("POST /v1/metadata/enums (authorized, valid body): same table, same 500", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/metadata/enums",
      headers: authHeaders(["platform_admin"], tid),
      payload: { name: "priority", values: ["low", "medium", "high"] },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json().message).toContain('relation "metadata.enum_definitions" does not exist');
  });

  it("GET /v1/metadata/schemas: 500 too -- it reads BOTH broken tables (lookup_tables and enum_definitions) via Promise.all", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: "/v1/metadata/schemas",
      headers: authHeaders(["staff"], tid),
    });
    expect(res.statusCode).toBe(500);
  });

  it("generic entity metadata GET/POST: 500 too -- it is backed by the same broken kv_store table", async () => {
    const tid = randomUUID();
    const entityId = randomUUID();
    const write = await app.inject({
      method: "POST",
      url: `/v1/metadata/trade_license/${entityId}`,
      headers: authHeaders(["tenant_admin"], tid),
      payload: { k: "renewalNote", v: "pending inspection" },
    });
    expect(write.statusCode).toBe(500);

    const read = await app.inject({
      method: "GET",
      url: `/v1/metadata/trade_license/${entityId}`,
      headers: authHeaders(["staff"], tid),
    });
    expect(read.statusCode).toBe(500);
    expect(read.json().message).toContain('relation "metadata.kv_store" does not exist');
  });
});
