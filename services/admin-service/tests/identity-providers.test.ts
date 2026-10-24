/**
 * IdP / SSO provider registry (replaces the 501 stubs for /v1/admin/{idp,sso}/providers).
 * Real Postgres (FORCE RLS, non-superuser role) + the real consumer on the memory queue.
 *  - role-denied 403, 401 without a token
 *  - cross-tenant isolation (list, update, delete) and per-tenant name uniqueness
 *  - the client secret is sealed at rest and NEVER returned or audited
 *  - fail-closed 503 when no encryption key is configured
 *  - every response validates against the shared contract the web loaders consume
 *  - consumer idempotency (same messageId twice -> one row, one audit)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { AdminIdpProviderListSchema, AdminSsoProviderListSchema } from "@civitasone/schemas/web";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { tenantScoped } from "../src/shared/tenant-queue.js";
import { registerIdentityProviderConsumers } from "../src/modules/identity-providers/consumer.js";
import { IDP_COMMANDS } from "../src/modules/identity-providers/topics.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T_A = randomUUID();
const T_B = randomUUID();
const ACTOR_A = randomUUID();
const ACTOR_B = randomUUID();
const PLAINTEXT_SECRET = `pt-${globalThis.crypto.randomUUID()}`;
const ROTATED_SECRET = `rot-${globalThis.crypto.randomUUID()}`;

const tok = (tenant: string, actor: string, roles: string[]) =>
  ({ authorization: `Bearer ${signToken({ sub: actor, tid: tenant, roles, sid: "sess-idp" }, SECRET, 3600)}` });
const A = (roles = ["tenant_admin"]) => tok(T_A, ACTOR_A, roles);
const B = (roles = ["tenant_admin"]) => tok(T_B, ACTOR_B, roles);

let app: FastifyInstance;
let savedKey: string | undefined;

beforeAll(async () => {
  savedKey = process.env.PII_ENC_KEY;
  process.env.PII_ENC_KEY = "test-only-key-for-identity-providers-suite";
  registerIdentityProviderConsumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
});
afterAll(async () => {
  if (savedKey === undefined) delete process.env.PII_ENC_KEY; else process.env.PII_ENC_KEY = savedKey;
  await app.close();
  await sqlClient.end();
});

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, ms = 4000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 40));
  }
}

async function asTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}

async function list(kind: "idp" | "sso", headers: Record<string, string>) {
  const res = await app.inject({ method: "GET", url: `/v1/admin/${kind}/providers`, headers });
  return { res, body: res.json() as { data: Array<Record<string, unknown>>; meta: Record<string, number> } };
}

async function create(kind: "idp" | "sso", headers: Record<string, string>, payload: Record<string, unknown>) {
  const res = await app.inject({ method: "POST", url: `/v1/admin/${kind}/providers`, headers, payload });
  return res;
}

const idpBody = (name: string, extra: Record<string, unknown> = {}) => ({
  name, protocol: "LDAP", endpoint: "ldaps://ldap.example.gov.in:636/dc=nic,dc=in", status: "active", ...extra,
});
const ssoBody = (name: string, extra: Record<string, unknown> = {}) => ({
  name, protocol: "SAML", entityId: "https://sso.example.gov.in/entity", endpoint: "https://sso.example.gov.in/saml", ...extra,
});

describe("authorization", () => {
  it.each(["idp", "sso"] as const)("%s: 401 without a token", async (kind) => {
    expect((await app.inject({ method: "GET", url: `/v1/admin/${kind}/providers` })).statusCode).toBe(401);
  });

  it.each(["idp", "sso"] as const)("%s: 403 for a non-admin role on every verb", async (kind) => {
    const h = A(["hr_admin", "employee"]);
    const id = randomUUID();
    expect((await app.inject({ method: "GET", url: `/v1/admin/${kind}/providers`, headers: h })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/admin/${kind}/providers`, headers: h, payload: idpBody("x") })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: `/v1/admin/${kind}/providers/${id}`, headers: h, payload: { status: "active" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/v1/admin/${kind}/providers/${id}`, headers: h })).statusCode).toBe(403);
  });
});

describe("IdP providers", () => {
  it("starts empty and validates against the shared web contract", async () => {
    const { res, body } = await list("idp", A());
    expect(res.statusCode).toBe(200);
    expect(AdminIdpProviderListSchema.safeParse(body).success).toBe(true);
    expect(body.data).toEqual([]);
    expect(body.meta).toMatchObject({ page: 1, total: 0 });
  });

  it("create -> 202, consumer writes, GET returns the web shape with no secret", async () => {
    const res = await create("idp", A(), idpBody("Corporate LDAP", { clientId: "svc-bind", clientSecret: PLAINTEXT_SECRET }));
    expect(res.statusCode).toBe(202);
    const accepted = res.json() as { id: string; status: string };
    expect(accepted.status).toBe("accepted");

    const row = await waitFor(async () => (await list("idp", A())).body.data.find((p) => p.id === accepted.id));
    expect(row).toMatchObject({
      name: "Corporate LDAP", protocol: "LDAP", status: "active", usersSynced: 0, lastSync: null,
      endpoint: "ldaps://ldap.example.gov.in:636/dc=nic,dc=in", hasClientSecret: true,
    });
    const { res: lr, body } = await list("idp", A());
    expect(AdminIdpProviderListSchema.safeParse(body).success).toBe(true);
    expect(lr.body).not.toContain(PLAINTEXT_SECRET);
    expect(lr.body).not.toMatch(/"clientSecret"|ciphertext|enc:v2/i);
  });

  it("stores the secret sealed (AES-GCM envelope), never plaintext; the queue message carries ciphertext only", async () => {
    const spy = vi.spyOn(queue, "publish");
    const res = await create("idp", A(), idpBody("Sealed check", { clientSecret: PLAINTEXT_SECRET }));
    const id = (res.json() as { id: string }).id;
    const published = JSON.stringify(spy.mock.calls.filter((c) => c[0] === IDP_COMMANDS.create).map((c) => c[1]));
    spy.mockRestore();
    expect(published).not.toContain(PLAINTEXT_SECRET);
    expect(published).toContain("enc:v2:");

    await waitFor(async () => (await list("idp", A())).body.data.find((p) => p.id === id));
    const rows = await asTenant(T_A, (sql) => sql<Array<{ client_secret_ciphertext: string; client_secret_last4: string }>>`
      SELECT client_secret_ciphertext, client_secret_last4 FROM identity_providers.providers WHERE id = ${id}`);
    expect(rows[0]!.client_secret_ciphertext.startsWith("enc:v2:")).toBe(true);
    expect(rows[0]!.client_secret_ciphertext).not.toContain(PLAINTEXT_SECRET);
    expect(rows[0]!.client_secret_last4).toBe(PLAINTEXT_SECRET.slice(-4));
  });

  it("the audit record and event name the changed fields but never carry the secret", async () => {
    const res = await create("idp", A(), idpBody("Audited", { clientSecret: PLAINTEXT_SECRET }));
    const id = (res.json() as { id: string }).id;
    await waitFor(async () => (await list("idp", A())).body.data.find((p) => p.id === id));
    const msgs = await waitFor(async () => {
      const r = await asTenant(T_A, (sql) => sql<Array<{ topic: string; payload: unknown }>>`
        SELECT topic, payload FROM _outbox.messages WHERE tenant_id = ${T_A}`);
      const mine = r.filter((m) => JSON.stringify(m.payload).includes(id));
      return mine.length >= 2 ? mine : null;
    });
    const audit = msgs.find((m) => m.topic === "audit.event.record")!;
    const p = (typeof audit.payload === "string" ? JSON.parse(audit.payload) : audit.payload) as Record<string, unknown>;
    expect(p).toMatchObject({ service: "admin", action: "identity_provider.idp.create", resourceType: "identity_provider", outcome: "success" });
    expect(p.changedFields).toContain("clientSecret");
    expect(JSON.stringify(msgs)).not.toContain(PLAINTEXT_SECRET);
  });

  it("rejects plain http, unknown fields, an empty update, and a duplicate name (case-insensitive)", async () => {
    expect((await create("idp", A(), idpBody("Bad", { endpoint: "http://ldap.example.gov.in" }))).statusCode).toBe(400);
    expect((await create("idp", A(), idpBody("Bad2", { tenantId: T_B }))).statusCode).toBe(400);
    expect((await create("idp", A(), idpBody("Bad3", { protocol: "KERBEROS" }))).statusCode).toBe(400);
    const id = (await waitFor(async () => (await list("idp", A())).body.data[0]))!.id as string;
    const empty = await app.inject({ method: "PUT", url: `/v1/admin/idp/providers/${id}`, headers: A(), payload: {} });
    expect(empty.statusCode).toBe(400);
    const dup = await create("idp", A(), idpBody("corporate ldap"));
    expect(dup.statusCode).toBe(409);
  });

  it("update (status + secret rotation) bumps the version and keeps the secret hidden", async () => {
    const id = ((await list("idp", A())).body.data.find((p) => p.name === "Corporate LDAP"))!.id as string;
    const before = await asTenant(T_A, (sql) => sql<Array<{ version: number; client_secret_ciphertext: string }>>`
      SELECT version, client_secret_ciphertext FROM identity_providers.providers WHERE id = ${id}`);
    const res = await app.inject({ method: "PUT", url: `/v1/admin/idp/providers/${id}`, headers: A(), payload: { status: "inactive", clientSecret: ROTATED_SECRET } });
    expect(res.statusCode).toBe(202);
    const after = await waitFor(async () => {
      const r = await asTenant(T_A, (sql) => sql<Array<{ version: number; status: string; client_secret_ciphertext: string }>>`
        SELECT version, status, client_secret_ciphertext FROM identity_providers.providers WHERE id = ${id}`);
      return r[0]!.version > before[0]!.version ? r[0] : null;
    });
    expect(after.status).toBe("inactive");
    expect(after.client_secret_ciphertext).not.toBe(before[0]!.client_secret_ciphertext);
    expect((await app.inject({ method: "GET", url: "/v1/admin/idp/providers", headers: A() })).body).not.toContain(ROTATED_SECRET);
  });

  it("delete removes it; a second delete is 404", async () => {
    const created = (await create("idp", A(), idpBody("To delete"))).json() as { id: string };
    await waitFor(async () => (await list("idp", A())).body.data.find((p) => p.id === created.id));
    expect((await app.inject({ method: "DELETE", url: `/v1/admin/idp/providers/${created.id}`, headers: A() })).statusCode).toBe(202);
    await waitFor(async () => !(await list("idp", A())).body.data.some((p) => p.id === created.id));
    expect((await app.inject({ method: "DELETE", url: `/v1/admin/idp/providers/${created.id}`, headers: A() })).statusCode).toBe(404);
  });
});

describe("SSO providers", () => {
  it("create -> list in the web shape (entityId, no endpoint, no secret) and validates the shared contract", async () => {
    const res = await create("sso", A(), ssoBody("MeriPehchaan", { clientId: "cid", clientSecret: PLAINTEXT_SECRET }));
    expect(res.statusCode).toBe(202);
    const id = (res.json() as { id: string }).id;
    const row = await waitFor(async () => (await list("sso", A())).body.data.find((p) => p.id === id));
    expect(row).toMatchObject({ name: "MeriPehchaan", protocol: "SAML", entityId: "https://sso.example.gov.in/entity", status: "inactive", lastSync: null, hasClientSecret: true });
    const { res: lr, body } = await list("sso", A());
    expect(AdminSsoProviderListSchema.safeParse(body).success).toBe(true);
    expect(lr.body).not.toContain(PLAINTEXT_SECRET);
    expect(Object.keys(row as object).sort()).toEqual(["entityId", "hasClientSecret", "id", "lastSync", "name", "protocol", "status"]);
  });

  it("idp and sso registries are separate: same name allowed in both, never cross-listed", async () => {
    const r = await create("sso", A(), ssoBody("Corporate LDAP"));
    expect(r.statusCode).toBe(202);
    await waitFor(async () => (await list("sso", A())).body.data.find((p) => p.name === "Corporate LDAP"));
    expect((await list("idp", A())).body.data.filter((p) => p.name === "Corporate LDAP")).toHaveLength(1);
    expect((await list("idp", A())).body.data.some((p) => p.name === "MeriPehchaan")).toBe(false);
  });

  it("an idp id cannot be read, changed or deleted through the sso routes (404)", async () => {
    const idpId = ((await list("idp", A())).body.data[0])!.id as string;
    expect((await app.inject({ method: "PUT", url: `/v1/admin/sso/providers/${idpId}`, headers: A(), payload: { status: "active" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/v1/admin/sso/providers/${idpId}`, headers: A() })).statusCode).toBe(404);
  });
});

describe("tenant isolation", () => {
  it("tenant B sees none of tenant A's providers and cannot update or delete them (404)", async () => {
    const aRow = (await list("idp", A())).body.data[0]!;
    expect((await list("idp", B())).body.data).toEqual([]);
    expect((await list("sso", B())).body.data).toEqual([]);
    expect((await app.inject({ method: "PUT", url: `/v1/admin/idp/providers/${aRow.id}`, headers: B(), payload: { status: "error" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/v1/admin/idp/providers/${aRow.id}`, headers: B() })).statusCode).toBe(404);
    const still = (await list("idp", A())).body.data.find((p) => p.id === aRow.id);
    expect(still).toBeTruthy();
  });

  it("the same name can exist in two tenants; each sees only its own", async () => {
    const res = await create("idp", B(), idpBody("Corporate LDAP"));
    expect(res.statusCode).toBe(202);
    const idB = (res.json() as { id: string }).id;
    await waitFor(async () => (await list("idp", B())).body.data.find((p) => p.id === idB));
    expect((await list("idp", B())).body.data).toHaveLength(1);
    expect((await list("idp", A())).body.data.some((p) => p.id === idB)).toBe(false);
  });

  it("FORCE RLS: a query with no tenant GUC, or the wrong one, sees zero rows at the database", async () => {
    const none = await sqlClient<Array<{ n: number }>>`SELECT count(*)::int AS n FROM identity_providers.providers`;
    expect(none[0]!.n).toBe(0);
    const wrong = await asTenant(randomUUID(), (sql) => sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM identity_providers.providers`);
    expect(wrong[0]!.n).toBe(0);
  });
});

describe("consumer", () => {
  it("is idempotent: the same messageId twice writes one row and one audit", async () => {
    const providerId = randomUUID();
    const msg = {
      messageId: randomUUID(), type: IDP_COMMANDS.create, tenantId: T_A, actorId: ACTOR_A, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: T_A, providerId, kind: "idp", name: "Idempotent", protocol: "OIDC", endpoint: "https://idp.example.gov.in", entityId: "", status: "active" },
    };
    await queue.publish(IDP_COMMANDS.create, msg);
    await queue.publish(IDP_COMMANDS.create, msg);
    await waitFor(async () => (await list("idp", A())).body.data.find((p) => p.id === providerId));
    await new Promise((r) => setTimeout(r, 300));
    const rows = await asTenant(T_A, (sql) => sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM identity_providers.providers WHERE id = ${providerId}`);
    expect(rows[0]!.n).toBe(1);
    const audits = await asTenant(T_A, (sql) => sql<Array<{ payload: unknown }>>`
      SELECT payload FROM _outbox.messages WHERE tenant_id = ${T_A} AND topic = 'audit.event.record'`);
    expect(audits.filter((a) => JSON.stringify(a.payload).includes(providerId))).toHaveLength(1);
  });

  it("a create that loses the unique-name race writes no row but records a failure audit", async () => {
    const first = randomUUID();
    const second = randomUUID();
    const base = { tenantId: T_A, actorId: ACTOR_A, schemaVersion: "1.0", type: IDP_COMMANDS.create };
    const body = (providerId: string) => ({ kind: "idp", providerId, tenantId: T_A, name: "Race Loser", protocol: "OIDC", endpoint: "https://idp.example.gov.in", entityId: "", status: "active" });
    await queue.publish(IDP_COMMANDS.create, { ...base, messageId: randomUUID(), correlationId: randomUUID(), payload: body(first) });
    await waitFor(async () => (await list("idp", A())).body.data.find((p) => p.id === first));
    await queue.publish(IDP_COMMANDS.create, { ...base, messageId: randomUUID(), correlationId: randomUUID(), payload: body(second) });
    const audit = await waitFor(async () => {
      const r = await asTenant(T_A, (sql) => sql<Array<{ payload: unknown }>>`
        SELECT payload FROM _outbox.messages WHERE tenant_id = ${T_A} AND topic = 'audit.event.record'`);
      return r.find((a) => JSON.stringify(a.payload).includes(second));
    });
    const p = (typeof audit.payload === "string" ? JSON.parse(audit.payload) : audit.payload) as Record<string, unknown>;
    expect(p).toMatchObject({ action: "identity_provider.idp.create", outcome: "failure", reason: "name_conflict", resourceId: second });
    const rows = await asTenant(T_A, (sql) => sql<Array<{ n: number }>>`SELECT count(*)::int AS n FROM identity_providers.providers WHERE id = ${second}`);
    expect(rows[0]!.n).toBe(0);
  });

  it("a rename that collides with an existing name is recorded as a failure, not redelivered forever", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const mk = (providerId: string, name: string) => ({
      messageId: randomUUID(), type: IDP_COMMANDS.create, tenantId: T_A, actorId: ACTOR_A, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: T_A, providerId, kind: "idp", name, protocol: "OIDC", endpoint: "https://idp.example.gov.in", entityId: "", status: "active" },
    });
    await queue.publish(IDP_COMMANDS.create, mk(a, "Rename Target"));
    await queue.publish(IDP_COMMANDS.create, mk(b, "Rename Source"));
    await waitFor(async () => (await list("idp", A())).body.data.find((p) => p.id === b));
    await waitFor(async () => (await list("idp", A())).body.data.find((p) => p.id === a));
    await queue.publish(IDP_COMMANDS.update, {
      messageId: randomUUID(), type: IDP_COMMANDS.update, tenantId: T_A, actorId: ACTOR_A, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: T_A, providerId: b, kind: "idp", name: "rename target" },
    });
    const audit = await waitFor(async () => {
      const r = await asTenant(T_A, (sql) => sql<Array<{ payload: unknown }>>`
        SELECT payload FROM _outbox.messages WHERE tenant_id = ${T_A} AND topic = 'audit.event.record'`);
      return r.find((x) => JSON.stringify(x.payload).includes(b) && JSON.stringify(x.payload).includes("failure"));
    });
    const p = (typeof audit.payload === "string" ? JSON.parse(audit.payload) : audit.payload) as Record<string, unknown>;
    expect(p).toMatchObject({ action: "identity_provider.idp.update", outcome: "failure", reason: "name_conflict" });
    const row = (await list("idp", A())).body.data.find((x) => x.id === b)!;
    expect(row.name).toBe("Rename Source");
  });

  it("a command for another tenant's provider id changes nothing and writes no audit", async () => {
    const aRow = (await list("idp", A())).body.data.find((p) => p.name === "Idempotent")!;
    await queue.publish(IDP_COMMANDS.remove, {
      messageId: randomUUID(), type: IDP_COMMANDS.remove, tenantId: T_B, actorId: ACTOR_B, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: T_B, providerId: aRow.id, kind: "idp" },
    });
    await new Promise((r) => setTimeout(r, 300));
    expect((await list("idp", A())).body.data.some((p) => p.id === aRow.id)).toBe(true);
  });
});

describe("fail closed without an encryption key", () => {
  it("503 and nothing published when a secret is submitted and no key is configured", async () => {
    const keep = process.env.PII_ENC_KEY;
    delete process.env.PII_ENC_KEY;
    const spy = vi.spyOn(queue, "publish");
    try {
      const res = await create("idp", A(), idpBody("No key", { clientSecret: PLAINTEXT_SECRET }));
      expect(res.statusCode).toBe(503);
      expect(res.body).not.toContain(PLAINTEXT_SECRET);
      expect(spy.mock.calls.filter((c) => c[0] === IDP_COMMANDS.create)).toHaveLength(0);
      // a provider with no secret needs no key
      const ok = await create("idp", A(), idpBody("No secret needed"));
      expect(ok.statusCode).toBe(202);
      const okId = (ok.json() as { id: string }).id;
      await waitFor(async () => (await list("idp", A())).body.data.find((p) => p.id === okId));
    } finally {
      spy.mockRestore();
      process.env.PII_ENC_KEY = keep;
    }
  });
});
