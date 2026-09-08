/**
 * SEC-006 — session-revocation denylist.
 *
 * Gap: `authPlugin` verified signature + expiry only. Revoking a session
 * (identity-service `DELETE /identity/sessions/:id`) only flipped a Postgres
 * row — the already-issued access token kept authenticating on every service
 * for up to its remaining lifetime (`accessTokenLifespan` = 3600s).
 *
 * DoD (per docs/ENTERPRISE-GAP-REPORT-2026-09-07.md): revoke a session ->
 * the next request using that session's old (still cryptographically valid,
 * not-yet-expired) access token gets 401 on EVERY service.
 *
 * We exercise the real `authPlugin` on Fastify instances via `.inject()`,
 * against the SAME shared denylist store every service's authPlugin reads —
 * that shared store (not any one service's process) is what makes this
 * fleet-wide, so two independent `buildApp()` instances below stand in for
 * two independent services (e.g. identity-service and tenant-service): they
 * share no code path except the store itself.
 *
 * MEMORY_STORE_ID_FOR_TESTS pins every `sharedStore()` call in this file to
 * one in-memory instance so tests don't require a live Redis, while still
 * exercising the exact production code path (`denylistSession` /
 * `isSessionDenylisted` -> `sharedStore()` -> `CacheStore`). CI additionally
 * runs this suite with REDIS_URL pointed at a real Redis container (see
 * package.json `test:integration`) to prove the same behaviour against the
 * real backing store, not just the in-memory fallback.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { authPlugin } from "../src/plugin.js";
import {
  denylistSession,
  isSessionDenylisted,
  __setDenylistStoreForTests,
} from "../src/denylist.js";
import { MemoryCache, type CacheStore } from "@civitasone/cache";

const JWT_SECRET = "sec-006-test-secret";
const TENANT = "00000000-0000-0000-0000-000000000001";
const ORIGINAL_ENV = { ...process.env };

function signAccessToken(sid: string, overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      sub: "11111111-1111-1111-1111-111111111111",
      tid: TENANT,
      roles: ["officer"],
      sid,
      iss: "civitasone-dev",
      aud: "civitasone",
      iat: now,
      exp: now + 3600, // matches accessTokenLifespan
      ...overrides,
    },
    JWT_SECRET,
    { algorithm: "HS256" },
  );
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(authPlugin);
  app.get("/v1/probe", async (req) => ({
    tenantId: req.ctx.tenantId,
    sessionId: req.ctx.sessionId,
  }));
  await app.ready();
  return app;
}

describe("SEC-006: session-revocation denylist", () => {
  let sharedMemoryStore: MemoryCache;

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: "test",
      JWT_ALGORITHM: "HS256",
      JWT_SECRET,
    };
    // One in-memory store shared by every buildApp() in a test, standing in
    // for the real Redis every service's authPlugin actually points at.
    sharedMemoryStore = new MemoryCache();
    __setDenylistStoreForTests(sharedMemoryStore);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    __setDenylistStoreForTests(null);
    vi.restoreAllMocks();
  });

  it("authenticates a valid, non-revoked token normally", async () => {
    const app = await buildApp();
    const token = signAccessToken("sid-not-revoked");
    const res = await app.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${token}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().sessionId).toBe("sid-not-revoked");
  });

  it("rejects (401) a cryptographically valid, not-yet-expired token once its sid is denylisted", async () => {
    const sid = "sid-to-be-revoked";
    const token = signAccessToken(sid);

    const app = await buildApp();
    const before = await app.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${token}` } });
    expect(before.statusCode).toBe(200); // sanity: token works pre-revoke

    // This is what identity-service's revoke consumer now does alongside
    // flipping the DB row.
    await denylistSession(sid);

    const after = await app.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${token}` } });
    await app.close();
    expect(after.statusCode).toBe(401);
    expect(after.json().message).toMatch(/revoked/i);
  });

  it("DoD: a session revoked via one service's write is rejected on every OTHER service's authPlugin (shared store)", async () => {
    const sid = "sid-fleet-wide";
    const token = signAccessToken(sid);

    // Two independent Fastify apps/plugin registrations = two independent
    // services, both gated by authPlugin, both reading the same shared store.
    const serviceA = await buildApp();
    const serviceB = await buildApp();

    expect((await serviceA.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    expect((await serviceB.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);

    // identity-service (serviceA's role here) revokes the session.
    await denylistSession(sid);

    // The token is rejected on BOTH — including the service that never
    // handled the revoke request itself.
    const resA = await serviceA.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${token}` } });
    const resB = await serviceB.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${token}` } });
    await serviceA.close();
    await serviceB.close();
    expect(resA.statusCode).toBe(401);
    expect(resB.statusCode).toBe(401);
  });

  it("does not affect a DIFFERENT session's token", async () => {
    const revokedSid = "sid-revoked-2";
    const otherSid = "sid-untouched";
    const revokedToken = signAccessToken(revokedSid);
    const otherToken = signAccessToken(otherSid);

    await denylistSession(revokedSid);

    const app = await buildApp();
    const revokedRes = await app.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${revokedToken}` } });
    const otherRes = await app.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${otherToken}` } });
    await app.close();
    expect(revokedRes.statusCode).toBe(401);
    expect(otherRes.statusCode).toBe(200);
  });

  it("isSessionDenylisted fails OPEN (returns false) when the store errors, and authPlugin lets the request through", async () => {
    const sid = "sid-during-redis-outage";
    const token = signAccessToken(sid);
    await denylistSession(sid); // actually revoked...

    // ...but the store is now unreachable (simulated Redis outage).
    const brokenStore: CacheStore = {
      get: vi.fn().mockRejectedValue(new Error("ECONNREFUSED (simulated Redis outage)")),
      set: vi.fn().mockRejectedValue(new Error("ECONNREFUSED (simulated Redis outage)")),
      del: vi.fn(),
      delByPrefix: vi.fn(),
      incr: vi.fn(),
    };
    __setDenylistStoreForTests(brokenStore);

    const warn = vi.fn();
    const denylisted = await isSessionDenylisted(sid, { warn });
    expect(denylisted).toBe(false); // fail open, not fail closed
    expect(warn).toHaveBeenCalled();

    // End-to-end: authPlugin must still let a valid, signature/expiry-valid
    // token through during the outage — a brief Redis outage must not lock
    // the whole fleet out (see denylist.ts for the documented tradeoff).
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${token}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("a request with no sessionId (e.g. the x-internal service path) skips the denylist check entirely", async () => {
    process.env.INTERNAL_SERVICE_SECRET = "svc-secret";
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/probe",
      headers: { "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": "svc-secret" },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });
});

describe("SEC-006: denylistSession / isSessionDenylisted unit behaviour", () => {
  beforeEach(() => {
    __setDenylistStoreForTests(new MemoryCache());
  });
  afterEach(() => {
    __setDenylistStoreForTests(null);
  });

  it("a sid never denylisted is reported as not denylisted", async () => {
    expect(await isSessionDenylisted("never-revoked")).toBe(false);
  });

  it("an empty/undefined sid is always treated as not denylisted (no-op), never throws", async () => {
    expect(await isSessionDenylisted("")).toBe(false);
    expect(await isSessionDenylisted(undefined)).toBe(false);
    await expect(denylistSession("")).resolves.toBeUndefined();
    await expect(denylistSession(undefined)).resolves.toBeUndefined();
  });
});

/**
 * SEC-006 fixup — coverage gap the review flagged: unlike the read side
 * (`isSessionDenylisted`), the write side (`denylistSession`, called from
 * identity-service's revoke consumer — `services/identity-service/src/
 * modules/sessions/consumer.ts`) has no try/catch. That is NOT a bug to fix
 * here: it is the correct behaviour given how this consumer's queue works.
 *
 * `services/queue-service/src/bus.ts` (`pollTopic`, ~line 730 onward): a
 * handler that throws anything other than `NonRetryableError` is treated as
 * a TRANSIENT failure — the message is left un-deleted, so SQS's visibility
 * timeout redelivers it, retried up to `SQS_MAX_RECEIVE_COUNT` (default 5)
 * before it is routed to the topic's dead-letter queue (never silently
 * dropped either way; see `bus.ts` ~line 762-769). If `denylistSession`
 * swallowed a Redis error here (mirroring the read side's fail-open), the
 * revoke would look like it succeeded while the denylist entry was never
 * written — losing the ONE piece of infra (redelivery-until-success) this
 * write actually needs, since there is no equivalent "fail open and keep
 * going" story on the write side the way there is for the read side gating
 * live requests. Left to throw, a Redis-down revoke instead gets retried
 * automatically until Redis recovers (or exhausts retries into the DLQ,
 * where it stays visible for operator replay) — and `denylistSession` is a
 * plain `SET`, so re-running it on redelivery is idempotent: no risk from
 * retrying the same sid more than once.
 *
 * This test exists only to LOCK IN that contract (propagate, don't swallow)
 * so a future edit doesn't accidentally add a try/catch that silently
 * breaks the redelivery story above.
 */
describe("SEC-006: denylistSession write-side behaviour when the store is down", () => {
  afterEach(() => {
    __setDenylistStoreForTests(null);
  });

  it("propagates (does not swallow) a store error — required so the queue's redelivery/DLQ retries the revoke instead of losing it", async () => {
    const brokenStore: CacheStore = {
      get: vi.fn().mockRejectedValue(new Error("ECONNREFUSED (simulated Redis outage)")),
      set: vi.fn().mockRejectedValue(new Error("ECONNREFUSED (simulated Redis outage)")),
      del: vi.fn(),
      delByPrefix: vi.fn(),
      incr: vi.fn(),
    };
    __setDenylistStoreForTests(brokenStore);

    await expect(denylistSession("sid-revoked-during-outage")).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });

  it("recovers cleanly once the store comes back — a retried revoke after a transient outage still lands", async () => {
    const brokenStore: CacheStore = {
      get: vi.fn().mockRejectedValue(new Error("ECONNREFUSED (simulated Redis outage)")),
      set: vi.fn().mockRejectedValue(new Error("ECONNREFUSED (simulated Redis outage)")),
      del: vi.fn(),
      delByPrefix: vi.fn(),
      incr: vi.fn(),
    };
    __setDenylistStoreForTests(brokenStore);

    const sid = "sid-revoked-then-recovered";
    await expect(denylistSession(sid)).rejects.toThrow(/ECONNREFUSED/);

    // Simulates the queue redelivering the same revoke command after Redis
    // has recovered — exactly what services/queue-service's visibility-
    // timeout redelivery does for a handler that threw.
    const recoveredStore = new MemoryCache();
    __setDenylistStoreForTests(recoveredStore);

    await expect(denylistSession(sid)).resolves.toBeUndefined();
    expect(await isSessionDenylisted(sid)).toBe(true);
  });
});

/**
 * Unlike every test above (which pins the store via
 * `__setDenylistStoreForTests` so the suite runs without any external
 * dependency), THIS block deliberately does NOT override the store — it lets
 * `sharedStore()` construct its store from the real environment, exactly as
 * production does. Run with `REDIS_URL` pointed at a real Redis (see the
 * PR's verification section / package.json `test:integration`) this exercises
 * the actual `RedisCache` class end-to-end, not just `MemoryCache`. Without
 * `REDIS_URL` set it still passes (falls back to `MemoryCache`, same as
 * every other test here) so the suite is never accidentally skipped.
 */
describe("SEC-006 integration: real env-derived store (RedisCache when REDIS_URL is set)", () => {
  const sid = `sid-integration-${Math.random().toString(36).slice(2)}`;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: "test", JWT_ALGORITHM: "HS256", JWT_SECRET };
    // The repo-root vitest.config.mjs forces CACHE_DRIVER=memory for every
    // suite by default (so the vast majority of tests need no external
    // services). This block is the deliberate exception — same pattern as
    // visitor-service's `document-scan-blacklist-screening-mismatch
    // .integration.test.ts` — overriding it back to the real Redis at
    // REDIS_URL so `sharedStore()` builds an actual `RedisCache`.
    process.env.CACHE_DRIVER = "redis";
    __setDenylistStoreForTests(null); // force the next call to rebuild from env
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    __setDenylistStoreForTests(null);
  });

  it("denylistSession -> isSessionDenylisted round-trips through the real configured store", async () => {
    expect(await isSessionDenylisted(sid)).toBe(false);
    await denylistSession(sid);
    expect(await isSessionDenylisted(sid)).toBe(true);
  });

  it("a full authPlugin request cycle rejects the token once denylisted, via the real store", async () => {
    const token = signAccessToken(sid);
    const app = await buildApp();
    await denylistSession(sid);
    const res = await app.inject({ method: "GET", url: "/v1/probe", headers: { authorization: `Bearer ${token}` } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
