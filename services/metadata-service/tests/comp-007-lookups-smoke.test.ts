/**
 * COMP-007 -- metadata-service `lookups` module (KV store, lookup tables +
 * values, enums, schema catalog, generic entity metadata) smoke test.
 *
 * Registered as a route only (app.ts, dynamic import) but had zero test
 * references anywhere in the service.
 *
 * History: `schema.ts` declares four tables in the `metadata` Postgres schema
 * -- `kv_store`, `lookup_tables`, `lookup_values`, `enum_definitions` -- and no
 * migration used to create any of them, so every DB-touching route answered 500
 * (`relation "metadata.<table>" does not exist`) and this file asserted those
 * 500s as a KNOWN ISSUE. Migration 0007_lookups_tables.sql now creates them (with
 * the unique indexes the routes' ON CONFLICT upserts need, plus RLS), so the
 * DB-touching tests below assert the real behaviour: writes are accepted and read
 * back, upserts replace, and tenants are isolated.
 *
 * Routes gated by auth/validation that fail BEFORE ever reaching the database
 * (401 with no token, 403 for a role outside the ACL, 400 for input that fails
 * `safeParse()`) are asserted first.
 *
 * Also shares config module's disclosed error-handling gap (see
 * comp-007-config-smoke.test.ts's file header): neither `config` nor `lookups`
 * registers a local Fastify error handler. This module shields itself from the
 * ZodError half of that gap: every route funnels validation through a local
 * `safeParse()` that throws `HttpError(400, "VALIDATION_FAILED", ...)`.
 *
 * Two write routes (POST /kv, POST /:entityType/:entityId) carry their own
 * "Deep-verify audit" comments noting a PRIOR fix added requireRole(ctx, ADMIN)
 * on both; confirmed below.
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

describe("COMP-007: lookups -- auth/validation gates that fail BEFORE reaching the database", () => {
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

describe("COMP-007: lookups -- DB-backed behaviour against the migrated tables (0007_lookups_tables.sql)", () => {
  const admin = (tid: string) => authHeaders(["tenant_admin"], tid);
  const staff = (tid: string) => authHeaders(["staff"], tid);

  it("kv: a write is accepted, read back by namespace and key, and a second write to the same key replaces it (ON CONFLICT upsert)", async () => {
    const tid = randomUUID();
    const first = await app.inject({ method: "POST", url: "/v1/metadata/kv", headers: admin(tid), payload: { ns: "prefs", k: "theme", v: { color: "blue" } } });
    expect(first.statusCode).toBe(202);
    const second = await app.inject({ method: "POST", url: "/v1/metadata/kv", headers: admin(tid), payload: { ns: "prefs", k: "theme", v: { color: "green" } } });
    expect(second.statusCode).toBe(202);
    await app.inject({ method: "POST", url: "/v1/metadata/kv", headers: admin(tid), payload: { ns: "prefs", k: "density", v: "compact" } });

    const all = await app.inject({ method: "GET", url: "/v1/metadata/kv?ns=prefs", headers: staff(tid) });
    expect(all.statusCode).toBe(200);
    const rows = (all.json() as { data: Array<{ k: string; v: unknown }> }).data;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.k === "theme")!.v).toEqual({ color: "green" });

    const one = await app.inject({ method: "GET", url: "/v1/metadata/kv?ns=prefs&k=density", headers: staff(tid) });
    expect((one.json() as { data: Array<{ k: string; v: unknown }> }).data).toEqual([expect.objectContaining({ k: "density", v: "compact" })]);

    const empty = await app.inject({ method: "GET", url: "/v1/metadata/kv?ns=other", headers: staff(tid) });
    expect((empty.json() as { data: unknown[] }).data).toEqual([]);
  });

  it("kv: is tenant-isolated", async () => {
    const a = randomUUID();
    const b = randomUUID();
    await app.inject({ method: "POST", url: "/v1/metadata/kv", headers: admin(a), payload: { k: "secret", v: 1 } });
    const res = await app.inject({ method: "GET", url: "/v1/metadata/kv", headers: staff(b) });
    expect((res.json() as { data: unknown[] }).data).toEqual([]);
  });

  it("lookups: create a table, add values, read it back with only its active values; unknown code is a real 404", async () => {
    const tid = randomUUID();
    const create = await app.inject({ method: "POST", url: "/v1/metadata/lookups", headers: admin(tid), payload: { code: "ward_types", label: "Ward Types", description: "d" } });
    expect(create.statusCode).toBe(202);

    for (const [valueCode, sortOrder] of [["urban", 2], ["rural", 1]] as const) {
      const v = await app.inject({ method: "POST", url: "/v1/metadata/lookups/ward_types/values", headers: admin(tid), payload: { valueCode, label: valueCode.toUpperCase(), sortOrder } });
      expect(v.statusCode).toBe(202);
    }

    const list = await app.inject({ method: "GET", url: "/v1/metadata/lookups", headers: staff(tid) });
    expect((list.json() as { data: Array<{ code: string }> }).data.map((r) => r.code)).toEqual(["ward_types"]);

    const one = await app.inject({ method: "GET", url: "/v1/metadata/lookups/ward_types", headers: staff(tid) });
    expect(one.statusCode).toBe(200);
    const body = one.json() as { code: string; label: string; isActive: boolean; values: Array<{ valueCode: string }> };
    expect(body).toMatchObject({ code: "ward_types", label: "Ward Types", isActive: true });
    expect(body.values.map((v) => v.valueCode).sort()).toEqual(["rural", "urban"]);

    const missing = await app.inject({ method: "GET", url: "/v1/metadata/lookups/does_not_exist", headers: staff(tid) });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("NOT_FOUND");

    const addToMissing = await app.inject({ method: "POST", url: "/v1/metadata/lookups/does_not_exist/values", headers: admin(tid), payload: { valueCode: "x", label: "X" } });
    expect(addToMissing.statusCode).toBe(404);
  });

  it("enums: create, read back, and re-posting the same name replaces its values (ON CONFLICT upsert); unknown name is a real 404", async () => {
    const tid = randomUUID();
    const create = await app.inject({ method: "POST", url: "/v1/metadata/enums", headers: authHeaders(["platform_admin"], tid), payload: { name: "priority", values: ["low", "medium", "high"] } });
    expect(create.statusCode).toBe(202);
    const replace = await app.inject({ method: "POST", url: "/v1/metadata/enums", headers: authHeaders(["platform_admin"], tid), payload: { name: "priority", values: ["p1", "p2"] } });
    expect(replace.statusCode).toBe(202);

    const got = await app.inject({ method: "GET", url: "/v1/metadata/enums/priority", headers: staff(tid) });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ name: "priority", values: ["p1", "p2"] });

    const missing = await app.inject({ method: "GET", url: "/v1/metadata/enums/nope", headers: staff(tid) });
    expect(missing.statusCode).toBe(404);
  });

  it("schemas: catalogues this tenant's lookup tables and enums together", async () => {
    const tid = randomUUID();
    await app.inject({ method: "POST", url: "/v1/metadata/lookups", headers: admin(tid), payload: { code: "dept_codes", label: "Departments" } });
    await app.inject({ method: "POST", url: "/v1/metadata/enums", headers: admin(tid), payload: { name: "status", values: ["open", "closed"] } });

    const res = await app.inject({ method: "GET", url: "/v1/metadata/schemas", headers: staff(tid) });
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Array<{ type: string; code?: string; name?: string }> }).data;
    expect(data).toHaveLength(2);
    expect(data.find((d) => d.type === "lookup")!.code).toBe("dept_codes");
    expect(data.find((d) => d.type === "enum")!.name).toBe("status");
  });

  it("generic entity metadata: POST then GET round-trips under the entity's namespace and is isolated per entity", async () => {
    const tid = randomUUID();
    const entityId = randomUUID();
    const write = await app.inject({ method: "POST", url: `/v1/metadata/trade_license/${entityId}`, headers: admin(tid), payload: { k: "renewalNote", v: "pending inspection" } });
    expect(write.statusCode).toBe(202);

    const read = await app.inject({ method: "GET", url: `/v1/metadata/trade_license/${entityId}`, headers: staff(tid) });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ entityType: "trade_license", entityId, data: [expect.objectContaining({ k: "renewalNote", v: "pending inspection" })] });

    const otherEntity = await app.inject({ method: "GET", url: `/v1/metadata/trade_license/${randomUUID()}`, headers: staff(tid) });
    expect((otherEntity.json() as { data: unknown[] }).data).toEqual([]);
  });
});
