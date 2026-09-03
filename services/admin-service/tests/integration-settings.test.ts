/**
 * integration-settings — route integration tests (admin-service).
 *
 * Exercises the governed lifecycle against a real Postgres with RLS:
 *   propose (PUT) → maker-checker approve → masked reads (secrets never leak)
 *   → optimistic version 409 → per-provider schema validation
 *   → test-connection fail-closed when unconfigured → RLS tenant isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

// Set the encryption key BEFORE buildApp so configKey() sees it.
process.env.CONFIG_ENC_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");
const { queue } = await import("../src/shared/infra.js");
const { tenantScoped } = await import("../src/shared/tenant-queue.js");
const { registerF3_integration_settings_Consumers } = await import("../src/modules/integration-settings/f3-consumer.js");

import { randomUUID } from "node:crypto";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// Fresh tenants per run so version numbers are deterministic (no cross-run
// data pollution against the shared Postgres).
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const PROPOSER = "11111111-eeee-4000-8000-000000000001";
const APPROVER = "22222222-eeee-4000-8000-000000000002";

function token(actorId: string, roles: string[] = ["tenant_admin"], tenantId = TENANT): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-int" }, SECRET, 3600);
}
function auth(actorId: string, roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(actorId, roles, tenantId)}` };
}

let app: FastifyInstance;
beforeAll(async () => {
  // propose(PUT)/approve/reject/disable were converted to F3 async; the
  // consumer that applies them only runs in src/worker.ts in production, so
  // register it here against the real queue singleton buildApp() wires the
  // routes through. Unlike central-config/data-correction, this module's
  // routes already carry synchronous pre-accept validation (PR #920) and key
  // everything off the (provider, envScope) tuple rather than a synthetic id,
  // so there's no id-echo/persisted-id mismatch to work around here.
  registerF3_integration_settings_Consumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
});
afterAll(async () => { await app.close(); await queue.stop(); await sqlClient.end(); });

function readAsTenant<T>(tenantId: string, run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

async function propose(
  provider: string, env: string, body: Record<string, unknown>, actor = PROPOSER, tenantId = TENANT,
): Promise<import("light-my-request").Response> {
  const res = await app.inject({
    method: "PUT", url: `/v1/admin/integrations/${provider}/${env}`,
    headers: auth(actor, ["tenant_admin"], tenantId), payload: body,
  });
  // F3 async — land the write before the caller's next step (approve/reject/
  // a version-conflict check against the live row) depends on it.
  await (queue as any).drain?.();
  return res;
}
async function approve(provider: string, env: string, actor = APPROVER, tenantId = TENANT) {
  const res = await app.inject({ method: "POST", url: `/v1/admin/integrations/${provider}/${env}/approve`, headers: auth(actor, ["tenant_admin"], tenantId), payload: {} });
  await (queue as any).drain?.();
  return res;
}

describe("integration-settings — auth + catalog", () => {
  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/integrations" });
    expect(res.statusCode).toBe(401);
  });
  it("403 for a non-admin role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/integrations", headers: auth(PROPOSER, ["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
  it("lists the full provider×env catalog even when unconfigured", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/integrations", headers: auth(APPROVER) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ provider: string; envScope: string; status: string; category: string }>;
    // 9 providers × 3 envs.
    expect(data.length).toBe(27);
    expect(data.every((r) => r.status === "unconfigured" || ["connected", "failed"].includes(r.status))).toBe(true);
    expect(data.some((r) => r.provider === "ai_anthropic" && r.category === "ai")).toBe(true);
  });
});

describe("integration-settings — per-provider schema validation", () => {
  it("rejects an invalid provider config (missing required secret)", async () => {
    const res = await propose("ai_anthropic", "dev", { config: { model: "claude-3-5-sonnet-latest" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_PROVIDER_CONFIG");
  });
  it("rejects an unknown provider (404)", async () => {
    const res = await propose("not_a_provider", "dev", { config: {} });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("UNKNOWN_PROVIDER");
  });
  it("rejects an invalid env scope (400)", async () => {
    const res = await propose("ai_anthropic", "production", { config: { apiKey: "sk-ant-xxxxxxxxxx" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_ENV_SCOPE");
  });
});

describe("integration-settings — propose + maker-checker approve", () => {
  it("proposes an upsert (status pending) and shows it as the pending change", async () => {
    const res = await propose("ai_anthropic", "dev", { config: { apiKey: "sk-ant-SECRETKEY123", model: "claude-3-5-sonnet-latest" }, note: "prod key" });
    expect(res.statusCode).toBe(202);
    // 202 command-acknowledgement envelope — "pending" is the persisted
    // change's own status, not this response's; verified below via GET.
    expect(res.json().status).toBe("accepted");

    const one = await app.inject({ method: "GET", url: "/v1/admin/integrations/ai_anthropic/dev", headers: auth(APPROVER) });
    expect(one.json().pendingChange?.status).toBe("pending");
    // secret masked, plaintext never returned.
    expect(one.json().pendingChange?.secretMasked).toBe("••••Y123");
  });

  it("BLOCKS the proposer from approving their own change (maker-checker)", async () => {
    await propose("sms_twilio", "dev", { config: { accountSid: "ACxxxxxxxxxx", authToken: "tok_SELF12345", fromNumber: "+15550001111" } });
    const res = await approve("sms_twilio", "dev", PROPOSER);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
  });

  it("a distinct approver applies the config and versions it", async () => {
    const res = await approve("ai_anthropic", "dev", APPROVER);
    expect(res.statusCode).toBe(202);
    // 202 command-acknowledgement envelope — "approved"/version only exist
    // once the async consumer applies the write; verified below via GET.
    expect(res.json().status).toBe("accepted");

    const one = await app.inject({ method: "GET", url: "/v1/admin/integrations/ai_anthropic/dev", headers: auth(APPROVER) });
    const d = one.json().data;
    expect(d.hasSecret).toBe(true);
    expect(d.secretMasked).toBe("••••Y123");
    expect(d.config.model).toBe("claude-3-5-sonnet-latest");
    expect(d.status).toBe("unconfigured");
    expect(d.version).toBe(1);
  });
});

describe("integration-settings — secrets never leak", () => {
  it("stores ciphertext (not plaintext) and never returns the secret in GET", async () => {
    await propose("whatsapp_meta", "staging", { config: { phoneNumberId: "1234567890", accessToken: "EAA_SUPERSECRET_TOKEN" } });
    await approve("whatsapp_meta", "staging", APPROVER);

    // Raw DB value must NOT contain the plaintext secret.
    const raw = await readAsTenant(TENANT, (sql) => sql<Array<{ secret_ciphertext: string | null; config: unknown }>>`
      SELECT secret_ciphertext, config FROM integration_settings.integration_settings
      WHERE tenant_id = ${TENANT} AND provider = 'whatsapp_meta' AND env_scope = 'staging'`);
    expect(raw[0]?.secret_ciphertext).toContain("v1:");
    expect(JSON.stringify(raw[0])).not.toContain("SUPERSECRET");

    // GET responses never carry the secret nor a `secretCiphertext` field.
    const one = await app.inject({ method: "GET", url: "/v1/admin/integrations/whatsapp_meta/staging", headers: auth(APPROVER) });
    const body = JSON.stringify(one.json());
    expect(body).not.toContain("SUPERSECRET");
    expect(body).not.toContain("secretCiphertext");
    expect(one.json().data.secretMasked).toBe("••••OKEN");
  });
});

describe("integration-settings — optimistic version", () => {
  it("returns 409 VERSION_CONFLICT on a stale expectedVersion", async () => {
    // ai_anthropic/dev is at version 1 now; propose with expectedVersion 99.
    const res = await propose("ai_anthropic", "dev", { config: { apiKey: "sk-ant-NEWKEY99999" }, expectedVersion: 99 });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("VERSION_CONFLICT");
  });
});

describe("integration-settings — reject", () => {
  it("rejects a pending change and blocks a re-decision", async () => {
    await propose("email_smtp", "dev", { config: { host: "smtp.example.com", port: 587, user: "u", password: "pw_reject_me", from: "a@b.com" } });
    const rej = await app.inject({ method: "POST", url: "/v1/admin/integrations/email_smtp/dev/reject", headers: auth(APPROVER), payload: { reason: "wrong host" } });
    expect(rej.statusCode).toBe(200); // reject sends a bare 200, unlike propose/approve
    await (queue as any).drain?.(); // land the rejection before the re-decision guard re-reads it
    const again = await approve("email_smtp", "dev", APPROVER);
    expect(again.statusCode).toBe(404);
    expect(again.json().code).toBe("NO_PENDING_CHANGE");
  });
});

describe("integration-settings — test-connection fail-closed", () => {
  it("returns 409 NOT_CONFIGURED when there is no live row to test", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/admin/integrations/ocr/prod/test", headers: auth(APPROVER), payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOT_CONFIGURED");
    expect(res.json().ok).toBe(false);
  });

  it("records a real failure (never a fake success) against an unreachable endpoint", async () => {
    // 127.0.0.1:1 refuses immediately → deterministic, fast.
    await propose("email_smtp", "prod", { config: { host: "127.0.0.1", port: 1, user: "u", password: "pw_x", from: "a@b.com" } });
    await approve("email_smtp", "prod", APPROVER);
    const res = await app.inject({ method: "POST", url: "/v1/admin/integrations/email_smtp/prod/test", headers: auth(APPROVER), payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    expect(res.json().status).toBe("failed");

    const one = await app.inject({ method: "GET", url: "/v1/admin/integrations/email_smtp/prod", headers: auth(APPROVER) });
    expect(one.json().data.status).toBe("failed");
    expect(one.json().data.lastTestedAt).toBeTruthy();
  });
});

describe("integration-settings — disable", () => {
  it("disables + clears the secret and bumps the version", async () => {
    const before = await app.inject({ method: "GET", url: "/v1/admin/integrations/whatsapp_meta/staging", headers: auth(APPROVER) });
    const v = before.json().data.version as number;
    const del = await app.inject({ method: "DELETE", url: "/v1/admin/integrations/whatsapp_meta/staging", headers: auth(APPROVER) });
    expect(del.statusCode).toBe(200); // disable sends a bare 200, unlike propose/approve
    await (queue as any).drain?.(); // land the disable before reading the row back
    const after = await app.inject({ method: "GET", url: "/v1/admin/integrations/whatsapp_meta/staging", headers: auth(APPROVER) });
    expect(after.json().data.enabled).toBe(false);
    expect(after.json().data.hasSecret).toBe(false);
    expect(after.json().data.version).toBe(v + 1);
  });
});

describe("integration-settings — RLS tenant isolation", () => {
  it("another tenant cannot see this tenant's configured integrations", async () => {
    await propose("ocr", "dev", { config: { provider: "gcv", apiKey: "ocr_KEY_ISO_1", endpoint: "https://ocr.example.com" } });
    await approve("ocr", "dev", APPROVER);

    const other = await app.inject({ method: "GET", url: "/v1/admin/integrations/ocr/dev", headers: auth(PROPOSER, ["tenant_admin"], OTHER_TENANT) });
    // Other tenant sees the catalog entry but it is unconfigured for them.
    expect(other.json().data.hasSecret).toBe(false);
    expect(other.json().data.status).toBe("unconfigured");
    expect(other.json().data.version).toBe(0);
  });
});
