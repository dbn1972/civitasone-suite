/**
 * FQ12-SEC (UAT items #69-#72): a freshly created API key could be listed but
 * GET /identity/api-keys/:id, rotate and revoke all answered 404 (getApiKey
 * read through the bare pool with no tenant GUC, so FORCE RLS hid the row),
 * which left a leaked key impossible to revoke. Verify also failed on UAT
 * because the identity_scanner DSN was never wired (see
 * tests/ops/fq12-ecosystem-security-env.test.ts); here the scanner DSN comes
 * from vitest.config.ts as in CI.
 *
 * Drives the real HTTP routes with the real consumer on the shared queue, as
 * the identity worker does in production (withTenantConsumer wrapping).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import type { Queue, Handler } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as sharedQueue } from "../src/shared/infra.js";
import { apiKeys, apiKeyAudit } from "../src/modules/apikeys/schema.js";
import { registerApiKeyConsumers } from "../src/modules/apikeys/consumer.js";

const JWT = process.env.JWT_SECRET as string;
const T = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();

function h(tid = T): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles: ["tenant_admin"], sid: `s-${randomUUID()}` } as never, JWT, 3600)}`,
    "content-type": "application/json",
  };
}

async function waitFor<V>(fn: () => Promise<V>, ok: (v: V) => boolean, timeoutMs = 5000): Promise<V> {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (!ok(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    last = await fn();
  }
  return last;
}

const row = (id: string) => runWithTenant(T, () => db.transaction((tx) => tx.select().from(apiKeys).where(eq(apiKeys.id, id))));

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  const raw = sharedQueue.subscribe.bind(sharedQueue);
  (sharedQueue as Queue).subscribe = ((topic: string, hd: Handler) => raw(topic, withTenantConsumer(hd) as Handler)) as typeof sharedQueue.subscribe;
  registerApiKeyConsumers(sharedQueue);
  await sharedQueue.start();
});
afterAll(async () => {
  await runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.delete(apiKeyAudit).where(eq(apiKeyAudit.tenantId, T));
    await tx.delete(apiKeys).where(eq(apiKeys.tenantId, T));
  }));
  await app.close();
  await sqlClient.end();
});

describe("API key lifecycle through the HTTP routes (fresh key)", () => {
  it("create -> get (no secret) -> verify -> rotate -> revoke -> verify fails", async () => {
    const created = await app.inject({
      method: "POST", url: "/identity/api-keys", headers: h(),
      payload: { name: "fq12-lifecycle", scopes: ["users:read"] },
    });
    expect(created.statusCode).toBe(202);
    const { id, key } = created.json() as { id: string; key: string };
    await waitFor(() => row(id), (r) => r.length === 1);

    // GET by id: 200, and no secret material in the response.
    const got = await app.inject({ method: "GET", url: `/identity/api-keys/${id}`, headers: h() });
    expect(got.statusCode).toBe(200);
    const view = got.json() as Record<string, unknown>;
    expect(view.id).toBe(id);
    expect(view.status).toBe("active");
    expect(view).not.toHaveProperty("secretHash");
    expect(view).not.toHaveProperty("key");
    expect(got.body).not.toContain(key);

    // Another tenant cannot read it.
    const foreign = await app.inject({ method: "GET", url: `/identity/api-keys/${id}`, headers: h(OTHER) });
    expect(foreign.statusCode).toBe(404);

    // Verify the freshly issued key.
    const v1 = await app.inject({ method: "POST", url: "/identity/api-keys/verify", headers: h(), payload: { key, requiredScope: "users:read" } });
    expect(v1.statusCode).toBe(200);
    expect(v1.json()).toMatchObject({ valid: true, apiKeyId: id, tenantId: T });

    // Rotate: new key works, old key does not.
    const rot = await app.inject({ method: "POST", url: `/identity/api-keys/${id}/rotate`, headers: h(), payload: { reason: "fq12 rotation" } });
    expect(rot.statusCode).toBe(202);
    const newKey = (rot.json() as { key: string }).key;
    expect(newKey).not.toBe(key);
    await waitFor(() => row(id), (r) => (r[0]?.keyVersion ?? 0) >= 2);
    const vOld = await app.inject({ method: "POST", url: "/identity/api-keys/verify", headers: h(), payload: { key } });
    expect(vOld.json().valid).toBe(false);
    const vNew = await app.inject({ method: "POST", url: "/identity/api-keys/verify", headers: h(), payload: { key: newKey } });
    expect(vNew.json()).toMatchObject({ valid: true, apiKeyId: id });

    // Revoke: 202, row revoked, verify fails afterwards.
    const rev = await app.inject({ method: "DELETE", url: `/identity/api-keys/${id}`, headers: h(), payload: { reason: "fq12 leaked" } });
    expect(rev.statusCode).toBe(202);
    const revoked = await waitFor(() => row(id), (r) => r[0]?.status === "revoked");
    expect(revoked[0]!.status).toBe("revoked");
    expect(revoked[0]!.revokedAt).not.toBeNull();
    const vRev = await app.inject({ method: "POST", url: "/identity/api-keys/verify", headers: h(), payload: { key: newKey } });
    expect(vRev.statusCode).toBe(200);
    expect(vRev.json().valid).toBe(false);

    const after = await app.inject({ method: "GET", url: `/identity/api-keys/${id}`, headers: h() });
    expect(after.statusCode).toBe(200);
    expect(after.json().status).toBe("revoked");
  });

  it("rotate / revoke of an id in another tenant is 404 (no cross-tenant action)", async () => {
    const created = await app.inject({ method: "POST", url: "/identity/api-keys", headers: h(), payload: { name: "fq12-xt", scopes: ["users:read"] } });
    const { id } = created.json() as { id: string };
    await waitFor(() => row(id), (r) => r.length === 1);
    const rot = await app.inject({ method: "POST", url: `/identity/api-keys/${id}/rotate`, headers: h(OTHER), payload: {} });
    expect(rot.statusCode).toBe(404);
    const rev = await app.inject({ method: "DELETE", url: `/identity/api-keys/${id}`, headers: h(OTHER), payload: {} });
    expect(rev.statusCode).toBe(404);
    expect((await row(id))[0]!.status).toBe("active");
  });
});

describe("verify does not leak or touch another tenant's key (review of PR #2372)", () => {
  const auditRows = (id: string) => runWithTenant(T, () => db.transaction((tx) =>
    tx.select().from(apiKeyAudit).where(eq(apiKeyAudit.apiKeyId, id))));

  async function issue(name: string): Promise<{ id: string; key: string }> {
    const res = await app.inject({ method: "POST", url: "/identity/api-keys", headers: h(), payload: { name, scopes: ["users:read"] } });
    expect(res.statusCode).toBe(202);
    const out = res.json() as { id: string; key: string };
    await waitFor(() => row(out.id), (r) => r.length === 1);
    return out;
  }

  it("a random key and another tenant's key get the SAME generic answer", async () => {
    const { key } = await issue("fq12-oracle");
    const random = await app.inject({ method: "POST", url: "/identity/api-keys/verify", headers: h(OTHER), payload: { key: `ck_${randomUUID()}${randomUUID()}` } });
    const foreign = await app.inject({ method: "POST", url: "/identity/api-keys/verify", headers: h(OTHER), payload: { key } });
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json()).toEqual({ valid: false, reason: "unknown key" });
    expect(foreign.json()).toEqual(random.json());
  });

  it("other-tenant key with a missing scope: generic answer, no ids/scopes, no lastUsedAt, no audit in the owner tenant", async () => {
    const { id, key } = await issue("fq12-scope-leak");
    const before = (await row(id))[0]!;
    const auditBefore = (await auditRows(id)).length;
    const res = await app.inject({ method: "POST", url: "/identity/api-keys/verify", headers: h(OTHER), payload: { key, requiredScope: "rbac:write" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: false, reason: "unknown key" });
    expect(res.body).not.toContain(id);
    expect(res.body).not.toContain(T);
    expect(res.body).not.toContain("users:read");
    const after = (await row(id))[0]!;
    expect(after.lastUsedAt).toEqual(before.lastUsedAt);
    expect((await auditRows(id)).length).toBe(auditBefore);
  });

  it("other-tenant REVOKED key: generic answer, no side effect", async () => {
    const { id, key } = await issue("fq12-revoked-leak");
    const rev = await app.inject({ method: "DELETE", url: `/identity/api-keys/${id}`, headers: h(), payload: {} });
    expect(rev.statusCode).toBe(202);
    await waitFor(() => row(id), (r) => r[0]?.status === "revoked");
    const auditBefore = (await auditRows(id)).length;
    const res = await app.inject({ method: "POST", url: "/identity/api-keys/verify", headers: h(OTHER), payload: { key } });
    expect(res.json()).toEqual({ valid: false, reason: "unknown key" });
    expect((await auditRows(id)).length).toBe(auditBefore);
  });

  it("same-tenant key with a missing scope keeps its specific (own-tenant) error", async () => {
    const { id, key } = await issue("fq12-own-scope");
    const res = await app.inject({ method: "POST", url: "/identity/api-keys/verify", headers: h(), payload: { key, requiredScope: "rbac:write" } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { valid: boolean; apiKeyId?: string; tenantId?: string; reason?: string };
    expect(body.valid).toBe(false);
    expect(body.apiKeyId).toBe(id);
    expect(body.tenantId).toBe(T);
    expect(body.reason).not.toBe("unknown key");
  });
});
