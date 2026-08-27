/**
 * Regression test for a bug found in independent review of PR #780
 * (deep-verification, 2026-08-27): tenant-service's service-wide rate limit
 * (registered in app.ts) is real and correctly rejects the 301st request in
 * a 1-minute window from the same actor/IP with a 429 from
 * @fastify/rate-limit -- but tenant/routes.ts's own setErrorHandler only
 * recognized ZodError/HttpError and demoted anything else (including that
 * 429) to a generic 500 INTERNAL. The cap genuinely blocks excess requests
 * (not a security bypass), but callers got an opaque 500 instead of a proper
 * 429 + Retry-After, which breaks well-behaved retry logic.
 *
 * This test file is DELIBERATELY SEPARATE from routes-coverage-full.test.ts
 * (which shares one long-lived `app` instance across ~350 tests): flooding
 * the shared instance past its rate-limit cap here would leave the limiter
 * tripped for the rest of that file's 1-minute window and break unrelated
 * tests. This file builds and closes its own isolated app instance instead.
 *
 * `app.inject()` requests default to remoteAddress 127.0.0.1, which is on
 * @civitasone/rate-limit's default allowList -- an unmodified inject() flood
 * would never trip the limiter at all. Each request below passes an explicit
 * non-loopback remoteAddress so the limiter's IP-based allowList exemption
 * doesn't mask the exact bug this test exists to catch.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";

const SECRET = "test_secret_for_civitasone_32chr";
const ACTOR = "cccccccc-0000-4000-8000-000000000001";
const TENANT = "dddddddd-0000-4000-8000-000000000001";
const REMOTE = "203.0.113.42"; // TEST-NET-3 (RFC 5737), definitely not on the allowList

function token(): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["tenant_admin"] }, SECRET, 3600);
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe("rate limit error passthrough (PR #780 review regression)", () => {
  it("the 301st request in the window gets a real 429 with Retry-After, not a demoted 500", async () => {
    const auth = { authorization: `Bearer ${token()}` };
    let lastRes: Awaited<ReturnType<typeof app.inject>> | undefined;

    // The service-wide limit is 300/min keyed by actorId. Fire past it using
    // a cheap, always-200-or-404 read path so we're only exercising the
    // limiter + error handler, not tenant-creation side effects.
    for (let i = 0; i < 305; i++) {
      lastRes = await app.inject({
        method: "GET",
        url: `/v1/tenants/${TENANT}`,
        headers: auth,
        remoteAddress: REMOTE,
      });
      if (lastRes.statusCode === 429) break;
    }

    expect(lastRes).toBeDefined();
    expect(lastRes!.statusCode).toBe(429);
    const body = lastRes!.json();
    // Before the fix this was {"code":"INTERNAL","message":"internal error",...}
    expect(body.code).not.toBe("INTERNAL");
    expect(body.retryable).toBe(true);
    expect(typeof body.retryAfter).toBe("number");
  });
});
