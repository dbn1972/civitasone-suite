/**
 * GET /v1/admin/platform-integrations/internal/active/:category -- the NON-SECRET descriptor finance-service uses to pick the
 * tenant's DSC signer (GAP-FINANCE-PFMS-01). Internal service path only; secret values never cross it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

process.env.INTERNAL_SERVICE_SECRET = "ffu-internal-secret-for-resolver-tests"; // gitleaks:allow
process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test-master-key-for-platform-integrations"; // gitleaks:allow

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = "aaaaaaaa-1111-4000-8000-0000000000f1";
const URL_ = "/v1/admin/platform-integrations/internal/active/dsc";
const internal = (tenant: string) => ({ "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET!, "x-tenant-id": tenant });

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await sqlClient.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`insert into platform_integrations.tenant_integrations (tenant_id, provider_key, category, environment, enabled, config, secrets, created_by, updated_by)
             values (${TENANT}, 'dsc_usb_token_bridge', 'dsc', 'sandbox', true, ${sqlClient.json({ bridgeHost: "127.0.0.1", certificateThumbprint: "ab".repeat(20) })},
                     ${sqlClient.json({ bridgeAccessToken: "enc:v2:k1:not-a-real-secret" })}, ${ACTOR}, ${ACTOR})`;
  });
});
afterAll(async () => {
  await sqlClient.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`delete from platform_integrations.tenant_integrations where tenant_id = ${TENANT}`;
  });
  await app.close();
  await sqlClient.end();
});

describe("internal active-integration resolver", () => {
  it("returns the tenant's active DSC integration as a descriptor with NO secret values", async () => {
    const res = await app.inject({ method: "GET", url: URL_, headers: internal(TENANT) });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d).toMatchObject({ providerKey: "dsc_usb_token_bridge", category: "dsc", environment: "sandbox", secretKeysSet: ["bridgeAccessToken"] });
    expect(d.config.certificateThumbprint).toBe("ab".repeat(20));
    expect(JSON.stringify(res.json())).not.toContain("not-a-real-secret");
    expect(d.secrets).toBeUndefined();
  });

  it("another tenant gets null (tenant isolation), a tenant with none gets null", async () => {
    const res = await app.inject({ method: "GET", url: URL_, headers: internal(OTHER) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeNull();
  });

  it("is refused without the internal service path: a tenant_admin JWT gets 403, a wrong secret gets 401", async () => {
    const jwt = signToken({ sub: ACTOR, tid: TENANT, roles: ["tenant_admin"], sid: "s-ffu" }, SECRET, 3600);
    expect((await app.inject({ method: "GET", url: URL_, headers: { authorization: `Bearer ${jwt}` } })).statusCode).toBe(403);
    const bad = await app.inject({ method: "GET", url: URL_, headers: { ...internal(TENANT), "x-service-secret": "wrong" } });
    expect(bad.statusCode).toBe(401);
  });

  it("rejects an unknown category", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/platform-integrations/internal/active/bogus", headers: internal(TENANT) });
    expect(res.statusCode).toBe(400);
  });
});
