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
// F3 CONSUMER WIRING — WHY THIS IS HERE:
// admin-service's F3 consumers are registered only in src/worker.ts, never in
// src/app.ts (the Fastify instance this test's harness builds). Without this,
// the propose (PUT) and approve (POST .../approve) routes each just publish a
// f3RouteWrite command and return 202 — nothing ever applies them, so
// repo.findSetting() stays null and the test-connection route fail-closes at
// 409 NOT_CONFIGURED *before* ever reaching the real SSRF-blocking logic. That
// made this suite's assertions vacuous: it always exercised the "unconfigured"
// guard, never the real destination-not-allowed check. Registering the SAME
// consumer function worker.ts uses (against the real in-memory test Queue,
// tenant-scoped exactly like worker.ts does it) lets propose→approve→test
// genuinely complete, so the assertions below run against the real guard.
// Pattern matches tests/feature-flags-rollout.test.ts (register consumer(s),
// queue.start(), then buildApp(); poll for async consumer effects instead of
// assuming synchronous application).
const { queue } = await import("../src/shared/infra.js");
const { tenantScoped } = await import("../src/shared/tenant-queue.js");
const { registerF3_integration_settings_Consumers } = await import("../src/modules/integration-settings/f3-consumer.js");

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
beforeAll(async () => {
  // Same registration call worker.ts makes (registerF3_integration_settings_Consumers
  // wrapped in tenantScoped(queue)) — not a reimplementation — against the real
  // Queue singleton so propose/approve/test all flow through the actual consumer.
  registerF3_integration_settings_Consumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
});
afterAll(async () => { await app.close(); await queue.stop(); await sqlClient.end(); });

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

async function settle(ms = 25): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// propose/approve are applied by the async F3 consumer, not synchronously by
// the route — poll (mirrors waitForFlag() in feature-flags-rollout.test.ts)
// instead of assuming the write has landed by the time the 202 comes back.
async function proposeAndWait(provider: string, env: string, body: Record<string, unknown>, tries = 40): Promise<void> {
  const res = await propose(provider, env, body);
  expect(res.statusCode).toBe(202);
  for (let i = 0; i < tries; i++) {
    const one = await get(provider, env);
    if (one.json().pendingChange) return;
    await settle();
  }
  throw new Error(`propose(${provider}/${env}) never produced a pending change — F3 consumer not draining`);
}

async function approveAndWait(provider: string, env: string, tries = 40): Promise<void> {
  const res = await approve(provider, env);
  expect(res.statusCode).toBe(202);
  for (let i = 0; i < tries; i++) {
    const one = await get(provider, env);
    const json = one.json();
    if (!json.pendingChange && json.data.status) return;
    await settle();
  }
  throw new Error(`approve(${provider}/${env}) was never applied — F3 consumer not draining`);
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
    await proposeAndWait("ai_anthropic", "dev", { config: { apiKey: "sk-ant-METAKEY0001", model: "claude-3-5-sonnet-latest", baseUrl: "http://169.254.169.254" } });
    await approveAndWait("ai_anthropic", "dev");
    await expectBlocked("ai_anthropic", "dev");
  });

  it("blocks payment_upi endpoint on loopback (127.0.0.1)", async () => {
    await proposeAndWait("payment_upi", "dev", { config: { vpa: "gov@upi", key: "upikey123456", endpoint: "http://127.0.0.1:8080/pay" } });
    await approveAndWait("payment_upi", "dev");
    await expectBlocked("payment_upi", "dev");
  });

  it("blocks ocr endpoint on an RFC1918 address (10.0.0.0/8)", async () => {
    await proposeAndWait("ocr", "dev", { config: { provider: "gcv", apiKey: "ocrkey123456", endpoint: "http://10.0.0.5/v1/ocr" } });
    await approveAndWait("ocr", "dev");
    await expectBlocked("ocr", "dev");
  });
});

describe("integration-settings SSRF — tcpGreeting path", () => {
  it("blocks email_smtp host on an RFC1918 address (192.168.0.0/16)", async () => {
    await proposeAndWait("email_smtp", "dev", { config: { host: "192.168.1.10", port: 25, user: "u", password: "pw_smtp_x", from: "a@b.com" } });
    await approveAndWait("email_smtp", "dev");
    await expectBlocked("email_smtp", "dev");
  });

  it("blocks sftp host pointing at the cloud metadata IP (169.254.169.254)", async () => {
    await proposeAndWait("sftp", "dev", { config: { host: "169.254.169.254", port: 22, username: "u", privateKey: "-----BEGIN KEY-----abc" } });
    await approveAndWait("sftp", "dev");
    await expectBlocked("sftp", "dev");
  });
});
