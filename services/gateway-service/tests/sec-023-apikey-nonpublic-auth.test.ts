/**
 * SEC-023 — API-key authentication can never reach any non-public proxied
 * route, because proxyHandler's own "Enforce authentication for all
 * non-public routes" check (app.ts) tested ONLY for a literal
 * `Authorization: Bearer` header and never consulted `req.apiKeyAuthenticated`
 * — the flag apiKeyPreHandler (api-key-auth.ts) sets only after verifying a
 * presented x-api-key against identity-service and injecting the verified
 * tenant/actor headers.
 *
 * Confirmed pre-fix against unmodified `main`: a request with a verified,
 * active, in-scope x-api-key and NO Authorization header got 401
 * UNAUTHENTICATED on /api/v1/finance/bills (a real, non-public, proxied
 * business route) — it only ever succeeded on a PUBLIC_PREFIXES route, where
 * proxyHandler skips this check entirely. Not a security hole itself (fails
 * closed), but the whole "W1.4 API Key authentication" feature was dead on
 * arrival for every real business route.
 *
 * Cross-reference: SEC-024 (open at the time of this fix) is a separate,
 * earlier-stage bug — apiKeyPreHandler's own verify call 404s against a
 * nonexistent identity-service path in the real deployed system, so
 * req.apiKeyAuthenticated can never actually be set to true today. This file
 * stubs global fetch's identity-service branch to return a successful verify
 * result, deliberately isolating THIS gate's own behavior (does an
 * already-verified api-key request pass it?) from whether that verification
 * can succeed end-to-end in production right now — see SEC-024, not fixed by
 * this PR.
 *
 * Fix: the check now also accepts an already-authenticated api-key request —
 * `if (!req.apiKeyAuthenticated && (!auth || !bearer)) { 401 }` — matching
 * the gap's own suggested fix and DoD (an end-to-end app.inject() test with a
 * verified, in-scope x-api-key and no Authorization header successfully
 * reaching a NON-public proxied route).
 *
 * Sabotage-checked: reverting the app.ts fix (keeping this file unchanged)
 * reproduces the exact 401 in the first test below; restoring the fix makes
 * it pass again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildApp } from "../src/app.js";

const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";

/**
 * Stubs global fetch for both destinations proxyHandler's request path can
 * reach once auth passes: identity-service's key-verify call, and the
 * upstream proxy target (finance-service). Same shape as the established
 * pattern in sec-008-tenant-rate-limit.test.ts.
 */
function stubIdentityAndUpstream() {
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.includes("/internal/apikeys/verify")) {
      return new Response(
        // SEC-024: identity-service's real /internal/apikeys/verify response is
        // VerifyResult (valid/apiKeyId/tenantId/ownerId/scopes/reason), not the
        // id/status/expiresAt shape this stub predates and used to send -- that
        // shape never matched anything identity-service actually returns. Kept
        // standing in for a genuinely valid, active key under the real contract.
        JSON.stringify({
          valid: true,
          apiKeyId: "key-1",
          tenantId: TENANT_A,
          ownerId: "owner-1",
          scopes: ["*:*"],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

beforeEach(() => {
  // Keep both rate-limit tiers out of the way — this file is about the auth
  // gate itself, not budgets (see sec-008-tenant-rate-limit.test.ts for that).
  process.env.GATEWAY_RATE_LIMIT_MAX = "1000000";
  process.env.GATEWAY_RATE_LIMIT_TENANT_MAX = "1000000";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GATEWAY_RATE_LIMIT_MAX;
  delete process.env.GATEWAY_RATE_LIMIT_TENANT_MAX;
});

describe("SEC-023: proxyHandler's auth gate must accept an already-verified api-key request", () => {
  it("DoD: a verified, in-scope x-api-key with NO Authorization header reaches a NON-public proxied route (200), not 401", async () => {
    stubIdentityAndUpstream();
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: { "x-api-key": "ak_live_test.secret" }, // deliberately no Authorization header
    });

    expect(res.statusCode).toBe(200);
  });

  it("negative control: a request with NEITHER a verified api key NOR a Bearer header is still 401 on the same non-public route — the fix narrows the gate, it does not remove it", async () => {
    stubIdentityAndUpstream(); // present but unused: no x-api-key header is sent below
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      // No x-api-key, no Authorization at all.
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).code).toBe("UNAUTHENTICATED");
  });
});
