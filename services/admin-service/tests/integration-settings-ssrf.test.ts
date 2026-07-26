/**
 * integration-settings — SSRF guard on the test-connection probe.
 *
 * A maker-checker-approved config whose endpoint/host points at the cloud
 * metadata endpoint, loopback, or an RFC1918 address must NOT be dialed by the
 * server-side `test()` probe. The probe must return a fixed, non-leaking
 * SSRF_BLOCKED error and must NOT persist any upstream response/banner in
 * last_error. Covers BOTH probe paths:
 *   - httpProbe   (ai_anthropic baseUrl, payment_upi endpoint, ocr endpoint)
 *   - tcpGreeting (email_smtp host, sftp host)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

process.env.CONFIG_ENC_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");

import { randomUUID } from "node:crypto";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const PROPOSER = "11111111-eeee-4000-8000-000000000001";
const APPROVER = "22222222-eeee-4000-8000-000000000002";

function token(actorId: string, roles: string[] = ["tenant_admin"], tenantId = TENANT): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-ssrf" }, SECRET, 3600);
}
function auth(actorId: string, roles?: string[], tenantId?: string) {
  return { authorization: `Bearer ${token(actorId, roles, tenantId)}` };
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

function propose(provider: string, env: string, body: Record<string, unknown>, tenantId = TENANT) {
  return app.inject({ method: "PUT", url: `/v1/admin/integrations/${provider}/${env}`, headers: auth(PROPOSER, ["tenant_admin"], tenantId), payload: body });
}
function approve(provider: string, env: string) {
  return app.inject({ method: "POST", url: `/v1/admin/integrations/${provider}/${env}/approve`, headers: auth(APPROVER), payload: {} });
}
function runTest(provider: string, env: string) {
  return app.inject({ method: "POST", url: `/v1/admin/integrations/${provider}/${env}/test`, headers: auth(APPROVER), payload: {} });
}
function get(provider: string, env: string) {
  return app.inject({ method: "GET", url: `/v1/admin/integrations/${provider}/${env}`, headers: auth(APPROVER) });
}

async function expectBlocked(provider: string, env: string) {
  const res = await runTest(provider, env);
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.ok).toBe(false);
  expect(body.status).toBe("failed");
  expect(String(body.error)).toContain("SSRF_BLOCKED");
  // The persisted last_error is the fixed guard string, NOT a fetched banner
  // (no "HTTP", no "SSH-", no "220", no body echo).
  const one = await get(provider, env);
  const lastError = String(one.json().data.lastError);
  expect(lastError).toBe("SSRF_BLOCKED: destination not allowed");
  expect(lastError).not.toMatch(/HTTP \d|SSH-|220 |ESMTP/);
}

describe("integration-settings SSRF — httpProbe path", () => {
  it("blocks ai_anthropic baseUrl pointing at the cloud metadata endpoint", async () => {
    await propose("ai_anthropic", "dev", { config: { apiKey: "sk-ant-METAKEY0001", model: "claude-3-5-sonnet-latest", baseUrl: "http://169.254.169.254" } });
    await approve("ai_anthropic", "dev");
    await expectBlocked("ai_anthropic", "dev");
  });

  it("blocks payment_upi endpoint on loopback (127.0.0.1)", async () => {
    await propose("payment_upi", "dev", { config: { vpa: "gov@upi", key: "upikey123456", endpoint: "http://127.0.0.1:8080/pay" } });
    await approve("payment_upi", "dev");
    await expectBlocked("payment_upi", "dev");
  });

  it("blocks ocr endpoint on an RFC1918 address (10.0.0.0/8)", async () => {
    await propose("ocr", "dev", { config: { provider: "gcv", apiKey: "ocrkey123456", endpoint: "http://10.0.0.5/v1/ocr" } });
    await approve("ocr", "dev");
    await expectBlocked("ocr", "dev");
  });
});

describe("integration-settings SSRF — tcpGreeting path", () => {
  it("blocks email_smtp host on an RFC1918 address (192.168.0.0/16)", async () => {
    await propose("email_smtp", "dev", { config: { host: "192.168.1.10", port: 25, user: "u", password: "pw_smtp_x", from: "a@b.com" } });
    await approve("email_smtp", "dev");
    await expectBlocked("email_smtp", "dev");
  });

  it("blocks sftp host pointing at the cloud metadata IP (169.254.169.254)", async () => {
    await propose("sftp", "dev", { config: { host: "169.254.169.254", port: 22, username: "u", privateKey: "-----BEGIN KEY-----abc" } });
    await approve("sftp", "dev");
    await expectBlocked("sftp", "dev");
  });
});
