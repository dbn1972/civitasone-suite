/**
 * COMP-007 -- policy-service `policies` module (policy documents: CRUD,
 * versions, publish/archive lifecycle, acknowledgment, compliance status)
 * smoke test.
 *
 * Registered as a route only (GET/POST/PATCH .../v1/policy/policies, plus
 * .../publish, .../archive, .../acknowledge, .../versions, and GET
 * .../v1/policy/compliance-status).
 *
 * History: this file originally documented a KNOWN ISSUE -- `policies/schema.ts`
 * declared `pgSchema("policies")` and three tables, but no migration ever created
 * them, so every request that reached the database answered 500
 * (`relation "policies.policies" does not exist`, 42P01) and the DB-touching tests
 * asserted that 500. Migration 0013_policy_documents_tables.sql (and the
 * `policies` schema in infra/db/bootstrap/bootstrap_missing_schemas.sql) now
 * create them, so those tests assert the real behaviour instead: a full
 * create -> version -> publish -> acknowledge -> compliance -> archive lifecycle,
 * the 404/409 guards, and tenant isolation.
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

  it("acknowledge has no requireRole -- any authenticated role reaches the DB layer (a 404 for an unknown policy, not a 403)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/policy/policies/${randomUUID()}/acknowledge`,
      headers: { authorization: `Bearer ${token(["citizen"])}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});

describe("COMP-007: policies -- lifecycle against the migrated tables (0013_policy_documents_tables.sql)", () => {
  const admin = () => ({ authorization: `Bearer ${token(["tenant_admin"])}` });
  const citizen = () => ({ authorization: `Bearer ${token(["citizen"])}` });

  async function createPolicy(over: Record<string, unknown> = {}): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/v1/policy/policies",
      headers: admin(),
      payload: { title: "IT Usage Policy", slug: `it-usage-${randomUUID().slice(0, 8)}`, content: "v1", ...over },
    });
    expect(res.statusCode).toBe(202);
    return (res.json() as { id: string }).id;
  }

  it("create persists the policy as a draft, with its first version, visible in list and get", async () => {
    const id = await createPolicy({ category: "security", tags: ["it", "security"] });

    const got = await app.inject({ method: "GET", url: `/v1/policy/policies/${id}`, headers: citizen() });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ id, tenantId: TENANT, status: "draft", category: "security", tags: ["it", "security"], version: 1, content: "v1" });

    const list = await app.inject({ method: "GET", url: "/v1/policy/policies", headers: citizen() });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: Array<{ id: string }> }).data.some((p) => p.id === id)).toBe(true);

    const versions = await app.inject({ method: "GET", url: `/v1/policy/policies/${id}/versions`, headers: citizen() });
    expect(versions.statusCode).toBe(200);
    const vs = (versions.json() as { data: Array<{ versionNum: number; status: string; content: string }> }).data;
    expect(vs).toHaveLength(1);
    expect(vs[0]).toMatchObject({ versionNum: 1, status: "draft", content: "v1" });
  });

  it("a content patch bumps the version and records a new version row", async () => {
    const id = await createPolicy();
    const patch = await app.inject({ method: "PATCH", url: `/v1/policy/policies/${id}`, headers: admin(), payload: { content: "v2" } });
    expect(patch.statusCode).toBe(202);

    const got = await app.inject({ method: "GET", url: `/v1/policy/policies/${id}`, headers: citizen() });
    expect(got.json()).toMatchObject({ version: 2, content: "v2" });

    const versions = await app.inject({ method: "GET", url: `/v1/policy/policies/${id}/versions`, headers: citizen() });
    const vs = (versions.json() as { data: Array<{ versionNum: number }> }).data;
    expect(vs.map((v) => v.versionNum)).toEqual([2, 1]);
  });

  it("publish -> acknowledge (idempotent per user) -> compliance-status counts one acknowledgment", async () => {
    const id = await createPolicy();

    // A draft cannot be acknowledged.
    const early = await app.inject({ method: "POST", url: `/v1/policy/policies/${id}/acknowledge`, headers: citizen(), payload: {} });
    expect(early.statusCode).toBe(409);

    const publish = await app.inject({ method: "POST", url: `/v1/policy/policies/${id}/publish`, headers: admin() });
    expect(publish.statusCode).toBe(202);
    const published = await app.inject({ method: "GET", url: `/v1/policy/policies/${id}`, headers: citizen() });
    expect(published.json()).toMatchObject({ status: "published" });
    expect(published.json().publishedAt).toBeTruthy();

    // The same user acknowledging twice upserts on (policy_id, user_id): one row.
    const ackHeaders = citizen();
    for (let i = 0; i < 2; i++) {
      const ack = await app.inject({ method: "POST", url: `/v1/policy/policies/${id}/acknowledge`, headers: ackHeaders, payload: { ipAddress: "10.0.0.7" } });
      expect(ack.statusCode).toBe(202);
    }

    const compliance = await app.inject({ method: "GET", url: "/v1/policy/compliance-status", headers: admin() });
    expect(compliance.statusCode).toBe(200);
    const row = (compliance.json() as { data: Array<{ id: string; acknowledgmentCount: number }> }).data.find((r) => r.id === id);
    expect(row).toBeDefined();
    // Same token (same actor) acknowledged twice: one row, not two.
    expect(row!.acknowledgmentCount).toBe(1);
  });

  it("an archived policy cannot be published again, and is no longer in compliance-status", async () => {
    const id = await createPolicy();
    await app.inject({ method: "POST", url: `/v1/policy/policies/${id}/publish`, headers: admin() });
    const archive = await app.inject({ method: "POST", url: `/v1/policy/policies/${id}/archive`, headers: admin() });
    expect(archive.statusCode).toBe(202);

    const again = await app.inject({ method: "POST", url: `/v1/policy/policies/${id}/publish`, headers: admin() });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("CONFLICT");

    const compliance = await app.inject({ method: "GET", url: "/v1/policy/compliance-status", headers: admin() });
    expect((compliance.json() as { data: Array<{ id: string }> }).data.some((r) => r.id === id)).toBe(false);
  });

  it("404s get / versions-empty / patch / publish / archive for a policy that does not exist", async () => {
    const id = randomUUID();
    const get = await app.inject({ method: "GET", url: `/v1/policy/policies/${id}`, headers: citizen() });
    expect(get.statusCode).toBe(404);

    const versions = await app.inject({ method: "GET", url: `/v1/policy/policies/${id}/versions`, headers: citizen() });
    expect(versions.statusCode).toBe(200);
    expect((versions.json() as { data: unknown[] }).data).toEqual([]);

    for (const [method, url] of [
      ["PATCH", `/v1/policy/policies/${id}`],
      ["POST", `/v1/policy/policies/${id}/publish`],
      ["POST", `/v1/policy/policies/${id}/archive`],
    ] as const) {
      const res = await app.inject({ method, url, headers: admin(), payload: method === "PATCH" ? { title: "x" } : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it("is tenant-isolated: another tenant cannot read the policy", async () => {
    const id = await createPolicy();
    const other = signToken({ sub: randomUUID(), tid: randomUUID(), roles: ["tenant_admin"], sid: "sess-other" }, SECRET);
    const res = await app.inject({ method: "GET", url: `/v1/policy/policies/${id}`, headers: { authorization: `Bearer ${other}` } });
    expect(res.statusCode).toBe(404);
  });
});
