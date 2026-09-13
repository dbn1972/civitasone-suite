/**
 * SEC-008 — Per-tenant rate limit keyed on a client-supplied header
 *
 * Gap: gateway-service's per-tenant rate-limit tier (`app.ts`, "SC-5") keyed
 * its bucket on `req.headers["x-tenant-id"] || req.ip` — a header the calling
 * client fully controls. Any authenticated caller could therefore:
 *   (a) set x-tenant-id to a VICTIM tenant's id to burn that tenant's shared
 *       200/min budget (denial of service against a tenant that never sent
 *       the traffic), or
 *   (b) mint a fresh fake tenant id on every request to shard its OWN traffic
 *       across unlimited buckets and evade the limit entirely.
 *
 * Fix: the bucket key now comes from a server-verified tenant identity only
 * (`verifiedTenantRateLimitKey` in app.ts) — the JWT `tid` claim that
 * jwtEdgeVerify already verifies and attaches as `req.jwtPayload`, or (for the
 * api-key auth path) `req.headers["x-tenant-id"]` ONLY once
 * `req.apiKeyAuthenticated` proves apiKeyPreHandler itself verified the key
 * and overwrote that header — never the client's original value. Falls back
 * to `req.ip` only for traffic with no verified identity at all (public
 * routes, pre-auth).
 *
 * A second, independent bug had to be fixed for this to be a real, testable
 * regression: the tier was registered with `global: false` and no route ever
 * set `config.rateLimit`, so — independent of the keyGenerator bug — it was
 * never actually applied to `/api/*` (confirmed empirically: 5 requests in a
 * row with GATEWAY_RATE_LIMIT_TENANT_MAX=2 all returned 200 on unpatched
 * main). The fix adds `config: { rateLimit: {} }` to the `/api/*` route so
 * the tier runs for real, and `hook: "preHandler"` so its keyGenerator runs
 * AFTER jwtEdgeVerify/apiKeyPreHandler have populated the verified identity
 * (the plugin's own default hook, "onRequest", fires before those).
 *
 * Sabotage-checked: reverting the app.ts fix while keeping this file
 * unchanged reproduces the exact spoofing bypass below (see PR description /
 * gap-report row for the transcript) — restoring the fix makes it pass again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT_B = "bbbbbbbb-0000-4000-8000-000000000002";
const MAX = 3; // small, deterministic budget for this tier in every test below

function tokenFor(tenantId: string, actorId = "actor-1") {
  return signToken(
    { sub: actorId, tid: tenantId, roles: ["finance_officer"] },
    SECRET,
    3600,
  );
}

async function hit(
  app: Awaited<ReturnType<typeof buildApp>>,
  opts: { token?: string; spoofTenantId?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.spoofTenantId !== undefined) headers["x-tenant-id"] = opts.spoofTenantId;
  const res = await app.inject({
    method: "GET",
    url: "/api/v1/finance/bills",
    headers,
  });
  return res.statusCode;
}

/** Fire `n` requests sequentially and collect status codes, in order. */
async function hitMany(
  app: Awaited<ReturnType<typeof buildApp>>,
  n: number,
  optsFor: (i: number) => { token?: string; spoofTenantId?: string },
) {
  const codes: number[] = [];
  for (let i = 0; i < n; i++) {
    codes.push(await hit(app, optsFor(i)));
  }
  return codes;
}

beforeEach(() => {
  process.env.GATEWAY_RATE_LIMIT_MAX = "1000000"; // keep the global tier out of the way
  process.env.GATEWAY_RATE_LIMIT_TENANT_MAX = String(MAX);
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GATEWAY_RATE_LIMIT_MAX;
  delete process.env.GATEWAY_RATE_LIMIT_TENANT_MAX;
});

describe("SEC-008: per-tenant rate limit is keyed on the verified JWT tid, not the client header", () => {
  it("a spoofed x-tenant-id header cannot SHARD a tenant's own traffic to evade its budget — every request from the same real tenant shares one bucket even with a different fake header each time", async () => {
    const app = await buildApp();

    // MAX requests, each with a DIFFERENT spoofed x-tenant-id, all under the
    // SAME real JWT tenant (A). If the header still influenced the key, each
    // would land in its own fresh bucket and never see a 429 no matter how
    // many were sent. They must instead all draw from tenant A's one bucket.
    const codes = await hitMany(app, MAX + 2, (i) => ({
      token: tokenFor(TENANT_A),
      spoofTenantId: `evade-shard-${i}`,
    }));

    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });

  it("a spoofed x-tenant-id header cannot BURN a victim tenant's budget — requests claiming to BE tenant B are still limited under the real caller's own tenant A, and B's real budget is left untouched", async () => {
    const app = await buildApp();

    // Tenant A's real JWT, but every request claims (via header) to be tenant B.
    const attackCodes = await hitMany(app, MAX + 1, () => ({
      token: tokenFor(TENANT_A),
      spoofTenantId: TENANT_B,
    }));
    // Consumed against A's own bucket (max=3): 3 through, then limited.
    expect(attackCodes).toEqual([200, 200, 200, 429]);

    // Tenant B, authenticating for real (real JWT tid=B, no spoofing at all),
    // must still have its full, untouched budget — proving none of the
    // attacker's "I am tenant B" requests above ever debited B's real bucket.
    const victimCodes = await hitMany(app, MAX, () => ({
      token: tokenFor(TENANT_B),
    }));
    expect(victimCodes).toEqual([200, 200, 200]);
  });

  it("legitimate rate limiting still works correctly for real, distinct tenants — independent budgets, correct threshold, no cross-contamination", async () => {
    const app = await buildApp();

    // Tenant A, authenticating normally (matching, non-spoofed x-tenant-id
    // header — the ordinary well-behaved client shape), exhausts its own
    // MAX-sized budget exactly at MAX.
    const aCodes = await hitMany(app, MAX + 1, () => ({
      token: tokenFor(TENANT_A),
      spoofTenantId: TENANT_A,
    }));
    expect(aCodes).toEqual([200, 200, 200, 429]);

    // Tenant B is completely unaffected by A's exhausted budget and gets its
    // own full MAX-sized allowance.
    const bCodes = await hitMany(app, MAX + 1, () => ({
      token: tokenFor(TENANT_B),
      spoofTenantId: TENANT_B,
    }));
    expect(bCodes).toEqual([200, 200, 200, 429]);
  });

  it("pre-authentication traffic (no JWT) falls back to IP, not the client-supplied header — a spoofed tenant id has no effect either way", async () => {
    const app = await buildApp();
    const FORM_KEY = "a".repeat(64);

    async function hitPublic(spoofTenantId: string) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/crm/public/leads/${FORM_KEY}`,
        headers: { "x-tenant-id": spoofTenantId },
        payload: { name: "Prospect", consent: true },
      });
      return res.statusCode;
    }

    // MAX + 1 requests with a FIXED fake tenant id.
    const fixedCodes: number[] = [];
    for (let i = 0; i < MAX + 1; i++) fixedCodes.push(await hitPublic("fixed-fake-tenant"));

    const app2 = await buildApp();
    async function hitPublic2(spoofTenantId: string) {
      const res = await app2.inject({
        method: "POST",
        url: `/api/v1/crm/public/leads/${FORM_KEY}`,
        headers: { "x-tenant-id": spoofTenantId },
        payload: { name: "Prospect", consent: true },
      });
      return res.statusCode;
    }
    // MAX + 1 requests, a DIFFERENT fake tenant id every time.
    const variedCodes: number[] = [];
    for (let i = 0; i < MAX + 1; i++) variedCodes.push(await hitPublic2(`varied-fake-tenant-${i}`));

    // Both sequences are governed by req.ip alone (identical for both apps
    // under app.inject()), so they must behave identically — proving the
    // header has zero influence on the key for unauthenticated traffic.
    expect(fixedCodes).toEqual(variedCodes);
    expect(fixedCodes).toEqual([200, 200, 200, 429]);
  });

  it("the api-key auth path also keys on the VERIFIED tenant (the resolved record's tenantId), not any client-supplied header", async () => {
    // apiKeyPreHandler resolves x-api-key against identity-service via fetch,
    // then OVERWRITES x-tenant-id with the verified record's tenantId before
    // this rate limiter ever runs (preHandler ordering, same as the JWT path,
    // since apiKeyPreHandler is a global preHandler too). Stub both fetch
    // destinations: the identity-service key lookup and the upstream proxy.
    //
    // Hits a PUBLIC route rather than /api/v1/finance/bills. This is
    // deliberate, not incidental: apiKeyPreHandler is unconditional (it runs
    // regardless of route publicness) so it still authenticates and injects
    // the verified tenant here, but proxyHandler's OWN separate auth check
    // (app.ts, "Enforce authentication for all non-public routes") only ever
    // looks for a literal `Authorization: Bearer` header and never consults
    // req.apiKeyAuthenticated — so on any NON-public route an api-key-only
    // request 401s there regardless of this fix. That is a real, separate,
    // pre-existing bug (the api-key auth feature cannot reach any non-public
    // proxied route today) — out of SEC-008's scope, flagged in the PR
    // description rather than silently fixed here. A public route sidesteps
    // it cleanly since proxyHandler skips that check entirely for isPublic
    // paths, letting this test isolate and prove the rate-limit keyGenerator
    // behavior on its own.
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("/internal/apikeys/verify")) {
        return new Response(
          JSON.stringify({
            id: "key-1",
            tenantId: TENANT_A,
            ownerId: "owner-1",
            scopes: ["*:*"],
            status: "active",
            expiresAt: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const app = await buildApp();
    const FORM_KEY = "b".repeat(64);

    async function hitWithApiKey(spoofTenantId: string) {
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/crm/public/leads/${FORM_KEY}`,
        headers: {
          "x-api-key": "ak_live_test.secret",
          "x-tenant-id": spoofTenantId,
        },
        payload: { name: "Prospect", consent: true },
      });
      return res.statusCode;
    }

    // MAX requests, each claiming via header to be a DIFFERENT fake tenant —
    // but the api key itself always verifies as the real tenant A, so they
    // must all draw from tenant A's one bucket regardless.
    const codes: number[] = [];
    for (let i = 0; i < MAX + 1; i++) codes.push(await hitWithApiKey(`spoofed-${i}`));
    expect(codes).toEqual([200, 200, 200, 429]);
  });
});
