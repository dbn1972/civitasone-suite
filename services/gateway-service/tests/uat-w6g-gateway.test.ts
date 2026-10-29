/**
 * UAT W6-G gateway routing / access defects.
 *
 *  F30  tenant-service plans / subscriptions / quotas / settings / org / code-lists / positions /
 *       data-governance / consent had no registry prefix: every call 404'd "no upstream for path".
 *  OPS  GET /ops/breakers (and /metrics/prom, /metrics/latency) answered 200 to an anonymous caller.
 *  PUB  the anonymous fire NOC / shop permit / trade licence QR-verify GETs were 401'd at the gateway
 *       although each upstream declares them config:{public:true}.
 *  SCIM /api/v1/identity/scim/* stays closed to a non-JWT bearer (deferred: F35 + PR #2380).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { resolveRoute } from "../src/registry.js";
import { applyConfig, getConfig } from "../src/runtime-config.js";
import { isPublicRoute, PUBLIC_ROUTES } from "../src/public-prefixes.js";

// HS256 test secret and internal secret come from vitest.config.ts env, never literals here.
const SECRET = process.env.JWT_SECRET as string;
const INTERNAL = process.env.INTERNAL_SERVICE_SECRET as string;
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000f6";
const ACTOR = "cccccccc-3333-4000-8000-0000000000f6";
const tok = (roles: string[]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s-w6g" }, SECRET, 3600);
const USER = tok(["employee"]);
const TENANT_ADMIN = tok(["tenant_admin", "super_admin"]);
const PLATFORM_ADMIN = tok(["platform_admin"]);

let calls: Array<{ url: string; init: RequestInit | undefined }> = [];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const TENANT_TREES: Array<[string, string]> = [
  ["/api/v1/plans", "tenant-plans"],
  ["/api/v1/subscriptions", "tenant-subscriptions"],
  ["/api/v1/quotas", "tenant-quotas"],
  ["/api/v1/settings", "tenant-settings"],
  ["/api/v1/org", "tenant-org"],
  ["/api/v1/code-lists", "tenant-code-lists"],
  ["/api/v1/positions", "tenant-positions"],
  ["/api/v1/data-governance", "tenant-data-governance"],
  ["/api/v1/consent", "tenant-consent"],
];

describe("F30: tenant-service resource trees are routed", () => {
  it.each(TENANT_TREES)("%s resolves to the tenant-service upstream (%s)", (prefix, name) => {
    const r = resolveRoute(`${prefix}/x`);
    expect(r?.route.name).toBe(name);
    expect(r?.route.upstream).toBe(resolveRoute("/api/v1/tenants")?.route.upstream);
  });

  it.each([
    ["/api/v1/plans", "/v1/plans"],
    ["/api/v1/subscriptions/current", "/v1/subscriptions/current"],
    ["/api/v1/quotas/" + TENANT, "/v1/quotas/" + TENANT],
    ["/api/v1/settings?prefix=setup", "/v1/settings?prefix=setup"],
    ["/api/v1/org/hierarchy", "/v1/org/hierarchy"],
    ["/api/v1/org/master-data/imports", "/v1/org/master-data/imports"],
    ["/api/v1/code-lists/gender/values", "/v1/code-lists/gender/values"],
    ["/api/v1/positions", "/v1/positions"],
    ["/api/v1/data-governance/domains", "/v1/data-governance/domains"],
    ["/api/v1/consent/requests", "/v1/consent/requests"],
  ])("authenticated GET %s is proxied to tenant-service %s", async (url, upstreamPath) => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${TENANT_ADMIN}` } });
    expect(res.statusCode).toBe(200);
    const c = calls.find((x) => x.url.endsWith(upstreamPath));
    expect(c, `no upstream call ending ${upstreamPath}: ${calls.map((x) => x.url).join(", ")}`).toBeDefined();
    expect(c?.url.startsWith("http://127.0.0.1:3002/")).toBe(true);
    // identity is the verified token's, not anything client-supplied
    expect((c?.init?.headers as Record<string, string>)["x-tenant-id"]).toBe(TENANT);
    await app.close();
  });

  it.each(TENANT_TREES)("%s still requires authentication at the edge", async (prefix) => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: prefix });
    expect(res.statusCode).toBe(401);
    expect(calls.filter((c) => c.url.includes(":3002"))).toHaveLength(0);
    await app.close();
  });

  it("does not swallow look-alike prefixes", () => {
    expect(resolveRoute("/api/v1/orgs/x")).toBeNull();
    expect(resolveRoute("/api/v1/plansx")).toBeNull();
    expect(resolveRoute("/api/v1/consents")).toBeNull();
  });
});

describe("OPS: gateway ops/diagnostic endpoints require an ops credential", () => {
  const OPS_PATHS = ["/ops/breakers", "/metrics/prom", "/metrics/latency"];

  it.each(OPS_PATHS)("GET %s without any credential -> 401", async (url) => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain("breakers");
    await app.close();
  });

  it.each(OPS_PATHS)("GET %s with an ordinary user / tenant-admin token -> 403", async (url) => {
    const app = await buildApp();
    for (const t of [USER, TENANT_ADMIN]) {
      const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${t}` } });
      expect(res.statusCode).toBe(403);
    }
    await app.close();
  });

  it.each(OPS_PATHS)("GET %s with a wrong internal secret or a forged token -> rejected", async (url) => {
    const app = await buildApp();
    const wrong = await app.inject({ method: "GET", url, headers: { "x-internal-secret": `${INTERNAL}x` } });
    expect(wrong.statusCode).toBe(403);
    const forged = signToken({ sub: ACTOR, tid: TENANT, roles: ["platform_admin"], sid: "s" }, `${SECRET}-other`, 3600);
    const bad = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${forged}` } });
    expect(bad.statusCode).toBe(401); // jwtEdgeVerify rejects the bad signature
    await app.close();
  });

  it.each(OPS_PATHS)("GET %s with the internal service secret -> 200", async (url) => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url, headers: { "x-internal-secret": INTERNAL } });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it.each(OPS_PATHS)("GET %s with a verified platform_admin token -> 200", async (url) => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${PLATFORM_ADMIN}` } });
    expect(res.statusCode).toBe(200);
    if (url === "/ops/breakers") expect(Array.isArray(res.json().breakers)).toBe(true);
    await app.close();
  });

  it("an UNVERIFIED platform_admin token (edge verify off) is not enough", async () => {
    const prev = getConfig().jwtEdgeVerify;
    applyConfig({ jwtEdgeVerify: "off" });
    try {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/ops/breakers", headers: { authorization: `Bearer ${PLATFORM_ADMIN}` } });
      expect(res.statusCode).toBe(403);
      await app.close();
    } finally {
      applyConfig({ jwtEdgeVerify: prev });
    }
  });

  it("monitoring endpoints stay public: /health 200 without a token, /ready not 401/403", async () => {
    const app = await buildApp();
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    const ready = await app.inject({ method: "GET", url: "/ready" });
    expect([200, 503]).toContain(ready.statusCode);
    await app.close();
  });
});

describe("PUB: exact anonymous verify GETs", () => {
  const VERIFY: Array<[string, string]> = [
    ["/api/v1/fire/nocs/verify", "http://127.0.0.1:3072/v1/fire/nocs/verify?code=W6G-1"],
    ["/api/v1/shop/permits/verify", "http://127.0.0.1:3060/v1/shop/permits/verify?code=W6G-1"],
    ["/api/v1/trade/licences/verify", "http://127.0.0.1:3070/v1/trade/licences/verify?code=W6G-1"],
  ];

  it("the allow-list is exactly the three GET verify paths", () => {
    expect(PUBLIC_ROUTES.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      "GET /api/v1/fire/nocs/verify",
      "GET /api/v1/shop/permits/verify",
      "GET /api/v1/trade/licences/verify",
    ]);
    expect(isPublicRoute("get", "/api/v1/fire/nocs/verify")).toBe(true);
    expect(isPublicRoute("POST", "/api/v1/fire/nocs/verify")).toBe(false);
    expect(isPublicRoute("GET", "/api/v1/fire/nocs/verify/")).toBe(false);
  });

  it.each(VERIFY)("anonymous GET %s reaches the upstream verify route", async (path, upstreamUrl) => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `${path}?code=W6G-1` });
    expect(res.statusCode).toBe(200);
    expect(calls.map((c) => c.url)).toContain(upstreamUrl);
    await app.close();
  });

  it.each(VERIFY)("GET %s forwards no client-supplied identity", async (path, upstreamUrl) => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `${path}?code=W6G-1`,
      headers: { authorization: "Bearer not-a-jwt", "x-tenant-id": TENANT, "x-actor-id": ACTOR },
    });
    // a stale/garbage browser token must not 401 a public lookup
    expect(res.statusCode).toBe(200);
    const c = calls.find((x) => x.url === upstreamUrl);
    const h = c?.init?.headers as Record<string, string>;
    expect(h["x-tenant-id"]).toBeUndefined();
    expect(h["x-actor-id"]).toBeUndefined();
    expect(h["authorization"]).toBeUndefined();
    await app.close();
  });

  it.each(VERIFY)("any other method on %s still requires a token", async (path) => {
    const app = await buildApp();
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD"] as const) {
      const res = await app.inject({ method, url: `${path}?code=W6G-1`, payload: method === "HEAD" ? undefined : {} });
      expect(res.statusCode, `${method} ${path}`).toBe(401);
    }
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("path variants and sibling routes still require a token", async () => {
    const app = await buildApp();
    for (const url of [
      "/api/v1/fire/nocs/verify/",
      "/api/v1/fire/nocs/verify/abc",
      "/api/v1/fire/nocs/verifyx?code=1",
      "/api/v1/fire/nocs/VERIFY?code=1",
      "/api/v1/fire/nocs",
      "/api/v1/fire/nocs/00000000-0000-4000-8000-000000000000",
      "/api/v1/fire/verify?code=1",
      "/api/v1/shop/permits/verify/x",
      "/api/v1/shop/permits",
      "/api/v1/shop/permits/verify.json?code=1",
      "/api/v1/trade/licences/verify/x",
      "/api/v1/trade/licences",
      "/api/v1/trade/licences/00000000-0000-4000-8000-000000000000/renew",
      "/api/v1/trade/verify?code=1",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(401);
    }
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("dot-segment / encoded traversal from the verify path is refused, not forwarded", async () => {
    const app = await buildApp();
    for (const url of [
      "/api/v1/fire/nocs/verify/../00000000-0000-4000-8000-000000000000",
      "/api/v1/fire/nocs/verify/%2e%2e/00000000-0000-4000-8000-000000000000",
      "/api/v1/shop/permits/verify%2f..%2fx",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect([400, 401, 404], url).toContain(res.statusCode);
    }
    expect(calls).toHaveLength(0);
    await app.close();
  });

  it("the advertisement / building / citizen verify routes keep working anonymously", async () => {
    const app = await buildApp();
    for (const url of [
      "/api/v1/advertisement/permits/verify?code=W6G-1",
      "/api/v1/building/permits/verify?code=W6G-1",
      "/api/v1/citizen/certificates/verify/w6g-token",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
    }
    await app.close();
  });
});

describe("SCIM stays closed (deferred to F35 / PR #2380)", () => {
  it("a non-JWT SCIM bearer is rejected at the edge and never proxied", async () => {
    const app = await buildApp();
    const anon = await app.inject({ method: "GET", url: "/api/v1/identity/scim/v2/Users" });
    expect(anon.statusCode).toBe(401);
    const scim = await app.inject({
      method: "GET",
      url: "/api/v1/identity/scim/v2/Users",
      headers: { authorization: "Bearer scim-opaque-w6g" },
    });
    expect(scim.statusCode).toBe(401);
    expect(calls.filter((c) => c.url.includes("/scim/"))).toHaveLength(0);
    await app.close();
  });
});
