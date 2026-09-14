/**
 * SEC-024 — POST /internal/apikeys/verify (identity-service side).
 *
 * This is the route api-key-auth.ts's apiKeyPreHandler (gateway-service)
 * calls directly over real HTTP (see gateway-service's
 * tests/sec-024-verify-real-http.test.ts for that end of the wire, spawning
 * this service as a real subprocess). Before this gap's fix, NOTHING was
 * registered at this path at all -- every request 404d. These tests exercise
 * the route in-process (buildApp() + app.inject()), covering what the
 * cross-process test does not: the assertGatewayRequest auth boundary itself,
 * and the full range of commands.verifyApiKey outcomes (unknown / revoked /
 * out-of-scope / valid), against a REAL database -- not a reimplementation of
 * the route or a stub of verifyApiKey.
 *
 * DB-gated: skipped unless a reachable identity DB is present (same
 * convention as apikeys-breakglass.db.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { withTenantConsumer } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";

const RUN_DB = process.env.DATABASE_URL ?? process.env.DB_URL;

const TENANT_A = "00000000-0000-0000-0000-0000000a2401";
const GATEWAY_HEADERS = {
  "x-gateway-request": "1",
  "x-internal-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
};

function ctx(tenantId: string, roles: string[]): RequestContext {
  return {
    tenantId, actorId: randomUUID(), actorType: "user", roles,
    correlationId: randomUUID(),
  };
}

// FLAKY-SKIP: Requires DATABASE_URL/DB_URL against a real Postgres for the SEC-024 internal verify route; unset in standard CI so this suite never executes there. (expires: 2026-12-13)
describe.skipIf(!RUN_DB)("SEC-024 — POST /internal/apikeys/verify", () => {
  let app: FastifyInstance;
  let apiCmd: typeof import("../src/modules/apikeys/commands.js");
  let apiQueue: MemoryQueue;

  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();

    apiCmd = await import("../src/modules/apikeys/commands.js");

    // Same real-consumer wiring as apikeys-breakglass.db.test.ts: issueApiKey
    // only queue.publish()es a command (F3 async); the row is written by the
    // registered consumer. Wire it onto the actual shared `queue` singleton
    // commands.ts publishes to (not a fresh MemoryQueue), and drain() after
    // each publish instead of racing a fixed sleep.
    const { queue } = await import("../src/shared/infra.js");
    const { registerApiKeyConsumers } = await import("../src/modules/apikeys/consumer.js");
    const rawSubscribe = queue.subscribe.bind(queue);
    queue.subscribe = ((topic: string, handler: any) =>
      rawSubscribe(topic, withTenantConsumer(handler))) as typeof queue.subscribe;
    registerApiKeyConsumers(queue);
    await queue.start();
    apiQueue = queue as unknown as MemoryQueue;
  });

  afterAll(async () => {
    await app.close();
  });

  async function drainApiQueue(): Promise<void> {
    await apiQueue.drain();
  }

  async function issueAndDrain(scopes: string[]) {
    const c = ctx(TENANT_A, ["tenant_admin"]);
    const issued = await apiCmd.issueApiKey(c, { name: `sec-024-${randomUUID()}`, scopes });
    await drainApiQueue();
    return issued;
  }

  // ── Auth boundary: assertGatewayRequest ───────────────────────────────────

  it("403s with no gateway headers at all — this route must not be reachable by an arbitrary caller", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/apikeys/verify",
      payload: { key: "irrelevant.does-not-matter" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s with x-internal-secret but no x-gateway-request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/apikeys/verify",
      headers: { "x-internal-secret": process.env.INTERNAL_SERVICE_SECRET ?? "" },
      payload: { key: "irrelevant.does-not-matter" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("403s with x-gateway-request but a wrong x-internal-secret", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/apikeys/verify",
      headers: { "x-gateway-request": "1", "x-internal-secret": "not-the-real-secret" },
      payload: { key: "irrelevant.does-not-matter" },
    });
    expect(res.statusCode).toBe(403);
  });

  // Also confirms this route is NOT reachable via a bearer JWT -- it is
  // gateway-only, unlike /identity/api-keys/verify.
  it("403s even with a valid super_admin bearer token but no gateway headers", async () => {
    const { signToken } = await import("@civitasone/auth");
    const secret = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
    const jwt = signToken({ sub: randomUUID(), tid: TENANT_A, roles: ["super_admin"] } as never, secret);
    const res = await app.inject({
      method: "POST",
      url: "/internal/apikeys/verify",
      headers: { authorization: `Bearer ${jwt}` },
      payload: { key: "irrelevant.does-not-matter" },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── Real verify outcomes, gated correctly, against a real DB ──────────────

  it("200s valid:true for a real, active, in-scope key — full shape gateway-service needs", async () => {
    const issued = await issueAndDrain(["finance:read", "hrms:*"]);

    const res = await app.inject({
      method: "POST",
      url: "/internal/apikeys/verify",
      headers: GATEWAY_HEADERS,
      payload: { key: issued.key, requiredScope: "finance:read" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.apiKeyId).toBe(issued.id);
    expect(body.tenantId).toBe(TENANT_A);
    expect(body.scopes).toEqual(["finance:read", "hrms:*"]);
    // SEC-024: gateway-service injects this as x-actor-id -- must be a real
    // uuid, not undefined/missing (the pre-fix response never carried it).
    expect(body.ownerId).toBeTruthy();
  });

  it("200s valid:false, reason 'unknown key' for a key that was never issued", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/apikeys/verify",
      headers: GATEWAY_HEADERS,
      payload: { key: `ak_live_${randomUUID()}.${randomUUID()}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toBe("unknown key");
  });

  it("200s valid:false for a key presented with an out-of-scope requiredScope", async () => {
    const issued = await issueAndDrain(["hrms:read"]);
    const res = await app.inject({
      method: "POST",
      url: "/internal/apikeys/verify",
      headers: GATEWAY_HEADERS,
      payload: { key: issued.key, requiredScope: "finance:write" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
    expect(body.reason).toMatch(/scope/);
  });

  it("200s valid:false for a revoked key", async () => {
    const issued = await issueAndDrain(["hrms:read"]);
    const c = ctx(TENANT_A, ["tenant_admin"]);
    await apiCmd.revokeApiKey(c, issued.id, "sec-024 test");
    await drainApiQueue();

    const res = await app.inject({
      method: "POST",
      url: "/internal/apikeys/verify",
      headers: GATEWAY_HEADERS,
      payload: { key: issued.key },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(false);
  });

  it("resolves a key regardless of which tenant issued it — tenant-blind by design (that is the whole point of this route vs. the admin one)", async () => {
    const otherTenant = "00000000-0000-0000-0000-0000000a2402";
    const c = ctx(otherTenant, ["tenant_admin"]);
    const issued = await apiCmd.issueApiKey(c, { name: `sec-024-other-${randomUUID()}`, scopes: ["hrms:read"] });
    await drainApiQueue();

    const res = await app.inject({
      method: "POST",
      url: "/internal/apikeys/verify",
      headers: GATEWAY_HEADERS,
      payload: { key: issued.key },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.valid).toBe(true);
    expect(body.tenantId).toBe(otherTenant);
  });
});
