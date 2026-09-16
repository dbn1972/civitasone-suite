/**
 * COMP-007 -- metadata-service `config` module (tenant configuration
 * export/import: entities, fields, layouts, validation rules, formulas,
 * compositions, number formats) smoke test.
 *
 * Registered as a route only (ADM-003, app.ts) but had zero test references
 * anywhere in the service. The only prior hits on the substring "config" in
 * this service's test suite are `set_config()` SQL calls and the UNRELATED
 * `preview` module's `/v1/metadata/config/preview` route (modules/preview/,
 * already unit-tested elsewhere) -- neither is this module.
 *
 * Investigated one suspected bug, found none: shared/db.ts carries a comment
 * claiming this service's "DATABASE_URL points to civitas_works", which would
 * mean every table this route reads (entityDefinitions etc.) 404s in
 * production. Checked directly against ecosystem.config.js's actual
 * svc()/worker() wiring (both civitas_metadata) and this service's own
 * vitest.config.ts CI fallback (also civitas_metadata) -- the comment is
 * simply stale documentation, not a live routing bug. Not touched here: a
 * doc-only correction to a file this module doesn't own is outside this
 * tranche's test-adding scope.
 *
 * GET /export's seven tables are all migrated (services/metadata-service/
 * migrations/000{1,2,3,4}*.sql), confirmed directly against a real disposable
 * Postgres below -- a fresh tenant's export 200s with seven empty arrays, not
 * a 500.
 *
 * POST /import only publishes CQRS commands (ENTITY_CREATE, FIELD_CREATE,
 * etc.) for the entities/fields/layouts/... modules' OWN consumers to apply --
 * verifying those consumers actually apply them is those modules' own test
 * scope, not this route's.
 *
 * REAL BUG (found while writing this test, not fixed here -- see PR
 * description): POST /import returns a raw 500 for invalid input instead of a
 * 400. Root-caused by direct instrumentation of the error-handling chain
 * (temporary debug logging in packages/schemas, reverted before this commit --
 * confirmed with `git diff`/`git status` clean): every OTHER route module in
 * this service (entities inline, plus fields/layouts/records/rules/formula/
 * composition/preview/numbering/forms via shared/errors.ts's
 * registerErrorHandler() or shared/api-errors.ts's registerStandardErrorHandler())
 * calls `app.setErrorHandler(...)` on ITS OWN Fastify child instance at the end
 * of its own route-registration function -- Fastify's plugin encapsulation
 * scopes that handler to only that module's own routes (api-errors.ts's own
 * comment already documents this encapsulation rule). `config` and `lookups`
 * are the only two modules that never do this. The service-level fallback,
 * `registerSchemaErrorHandler(app, HttpError)` in app.ts, is called AFTER
 * every route module is already registered and -- confirmed by temporarily
 * instrumenting its returned handler function with unconditional file-write
 * logging -- never actually executes for ANY request in this app, config's
 * included. So a ZodError thrown in config's (or lookups') own `.parse()`
 * calls reaches no custom handler at all and falls through to Fastify's bare
 * built-in default (a generic 500, not the service's `{code, message,
 * correlationId}` envelope). HttpError-based responses (401/403 below) still
 * come out with the right status only because Fastify's own built-in fallback
 * happens to read `error.statusCode || error.status` when picking a status
 * code -- confirmed in fastify's own error-handler.js -- not because any
 * custom envelope logic ran.
 *
 * This is the identical bug shape COMP-007 tranche 2 found and disclosed
 * (not fixed) for policy-service/bindings ("no error handler on invalid
 * input, raw 500 vs 400") -- same discipline followed here: this gap's DoD is
 * adding tests, not patching application error-handling wiring, even though a
 * fix would be small (one import + one call, mirroring the other 8 modules'
 * exact pattern). Left disclosed. Likely shares the same root cause with
 * `lookups` (this service's other locally-unhandled module) -- confirmed
 * independently when that module was tested in this same tranche (see
 * comp-007-lookups-smoke.test.ts).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function token(roles: string[], tid: string) {
  return signToken({ sub: randomUUID(), tid, roles, sid: "sess-comp007-config" }, SECRET);
}

const app = await buildApp();

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("COMP-007: metadata config -- GET /v1/metadata/config/export", () => {
  it("returns 401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/metadata/config/export" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role outside the admin ACL", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: "/v1/metadata/config/export",
      headers: { authorization: `Bearer ${token(["staff"], tid)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("a fresh tenant's export is a real DB round trip: 200 with all seven sections present and empty, not a 500", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "GET",
      url: "/v1/metadata/config/export",
      headers: { authorization: `Bearer ${token(["metadata_admin"], tid)}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.tenantId).toBe(tid);
    expect(body.version).toBe("1.0");
    for (const key of [
      "entities",
      "fields",
      "layouts",
      "validationRules",
      "formulas",
      "compositions",
      "numberFormats",
    ]) {
      expect(Array.isArray(body[key]), key).toBe(true);
      expect(body[key], key).toHaveLength(0);
    }
  });
});

describe("COMP-007: metadata config -- POST /v1/metadata/config/import", () => {
  it("returns 401 without a token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/metadata/config/import",
      payload: { version: "1.0" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role outside the admin ACL", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/metadata/config/import",
      headers: { authorization: `Bearer ${token(["staff"], tid)}` },
      payload: { version: "1.0" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("KNOWN ISSUE (see file header): a body missing the required 'version' field 500s instead of 400 -- no local error handler catches the ZodError", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/metadata/config/import",
      headers: { authorization: `Bearer ${token(["metadata_admin"], tid)}` },
      payload: { entities: [] },
    });
    // NOT the desired behavior -- documents the bug. Every other tested route
    // in this service returns 400 with {code:"VALIDATION_FAILED",...} for the
    // identical mistake (see e.g. entities' POST /v1/metadata/entities).
    expect(res.statusCode).toBe(500);
  });

  it("an authorized import publishes exactly one command per item across all seven sections", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/metadata/config/import",
      headers: { authorization: `Bearer ${token(["platform_admin"], tid)}` },
      payload: {
        version: "1.0",
        entities: [{ apiName: "imported_entity" }],
        fields: [{ apiName: "imported_field" }],
        layouts: [{ name: "imported_layout" }],
        validationRules: [{ name: "imported_rule" }],
        formulas: [{ name: "imported_formula" }],
        compositions: [{ name: "imported_composition" }],
        numberFormats: [{ name: "imported_format" }],
      },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json().data;
    expect(body.status).toBe("accepted");
    expect(body.commandsPublished).toBe(7);
    expect(typeof body.batchId).toBe("string");
  });

  it("an empty import (all sections omitted) is accepted with zero commands published, not an error", async () => {
    const tid = randomUUID();
    const res = await app.inject({
      method: "POST",
      url: "/v1/metadata/config/import",
      headers: { authorization: `Bearer ${token(["metadata_admin"], tid)}` },
      payload: { version: "1.0" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().data.commandsPublished).toBe(0);
  });
});
