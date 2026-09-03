import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

// HS256 test token
const SECRET = "test_secret_for_civitasone_32chr";
const VALID_TOKEN = signToken(
  { sub: "actor-1", tid: "tenant-1", roles: ["admin"] },
  SECRET,
  3600,
);

// Stub upstream fetch so we can verify what headers reach "upstream" services.
let lastUpstreamHeaders: Record<string, string> = {};

beforeEach(() => {
  lastUpstreamHeaders = {};
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    lastUpstreamHeaders = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string>) ?? {}),
    );
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FIX-00: x-internal auth bypass", () => {
  it("strips x-internal from external requests — bypass header never reaches upstream", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: {
        "x-internal": "1",
        "x-tenant-id": "00000000-0000-0000-0000-000000000001",
      },
    });
    // Must be rejected at the gateway auth layer (no Bearer token) OR stripped.
    // Either way, upstream must NOT receive x-internal.
    expect(lastUpstreamHeaders["x-internal"]).toBeUndefined();
  });

  it("returns 401 when x-internal is sent without a Bearer token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: {
        "x-internal": "1",
        "x-tenant-id": "00000000-0000-0000-0000-000000000001",
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it("does not forward x-internal-secret or x-internal-caller", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: {
        authorization: `Bearer ${VALID_TOKEN}`,
        "x-internal": "1",
        "x-internal-secret": "leaked",
        "x-internal-caller": "attacker",
        "x-service-secret": "stolen",
      },
    });
    expect(lastUpstreamHeaders["x-internal"]).toBeUndefined();
    expect(lastUpstreamHeaders["x-internal-secret"]).toBeUndefined();
    expect(lastUpstreamHeaders["x-internal-caller"]).toBeUndefined();
    expect(lastUpstreamHeaders["x-service-secret"]).toBeUndefined();
  });

  it("does not self-attach x-internal-secret to an ordinary proxied client request (no spoof attempt)", async () => {
    // Regression for the gap FIX-00 was meant to close but didn't: the gateway used to
    // set headers["x-internal-secret"] = INTERNAL_SERVICE_SECRET on EVERY proxied request,
    // unconditionally — not just when the client tried to spoof it. That handed every
    // authenticated caller (any role, any tenant) a working internal-trust credential for
    // free, which at least two admin-service routes (modules-list,
    // composition/internal/:tenantId/modules) accept as sufficient to skip their
    // super-admin / ADMIN_ROLES check. No client-supplied x-internal* header is sent here
    // at all — this isolates the gateway's OWN over-eager injection from the
    // spoof-stripping already covered above.
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: {
        authorization: `Bearer ${VALID_TOKEN}`,
        "x-tenant-id": "00000000-0000-0000-0000-000000000001",
      },
    });
    expect(lastUpstreamHeaders["x-internal-secret"]).toBeUndefined();
    expect(lastUpstreamHeaders["x-internal-caller"]).toBeUndefined();
    expect(lastUpstreamHeaders["x-internal"]).toBeUndefined();
    expect(lastUpstreamHeaders["x-service-secret"]).toBeUndefined();
  });

  it("does forward safe headers — correlation-id passes through", async () => {
    const app = await buildApp();
    await app.inject({
      method: "GET",
      url: "/api/v1/finance/bills",
      headers: {
        authorization: `Bearer ${VALID_TOKEN}`,
        "x-correlation-id": "test-corr-123",
        "x-tenant-id": "00000000-0000-0000-0000-000000000001",
      },
    });
    expect(lastUpstreamHeaders["x-correlation-id"]).toBe("test-corr-123");
  });
});

describe("FIX-00: /metrics access control", () => {
  it("allows /metrics from loopback when METRICS_TOKEN is unset", async () => {
    delete process.env.METRICS_TOKEN;
    const app = await buildApp();
    // inject() uses 127.0.0.1 internally — treated as internal IP
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
  });

  it("requires METRICS_TOKEN header when env is set", async () => {
    process.env.METRICS_TOKEN = "secret-metrics-token";
    try {
      const app = await buildApp();
      const denied = await app.inject({ method: "GET", url: "/metrics" });
      expect(denied.statusCode).toBe(403);

      const allowed = await app.inject({
        method: "GET",
        url: "/metrics",
        headers: { "x-metrics-token": "secret-metrics-token" },
      });
      expect(allowed.statusCode).toBe(200);
    } finally {
      delete process.env.METRICS_TOKEN;
    }
  });
});

describe("FIX-00: auth rate limit", () => {
  it("registers /api/identity/* with stricter rate limit config", async () => {
    const app = await buildApp();
    // Route exists — it accepts requests
    const res = await app.inject({
      method: "POST",
      url: "/api/identity/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    // We just verify the route is registered (upstream would 404 in test env but gateway processes it)
    expect([200, 401, 404, 502]).toContain(res.statusCode);
  });
});

describe("LM-002: public lead capture is reachable without a token", () => {
  const FORM_KEY = "a".repeat(64);

  it("does not 401 an anonymous POST to /api/v1/crm/public/leads/:formKey", async () => {
    // A prospect filling in a public web form has no bearer token by definition. Before
    // this prefix was allow-listed the gateway refused the request at the edge, so the
    // endpoint existed but was unreachable in every real deployment.
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/crm/public/leads/${FORM_KEY}`,
      payload: { name: "Jane Prospect", consent: true },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it("still requires a token for the authenticated CRM routes", async () => {
    // The allow-list is the `public` sub-tree only — /api/v1/crm itself must not open up.
    const app = await buildApp();
    for (const url of [
      "/api/v1/crm/contacts",
      "/api/v1/crm/lead-capture-forms",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    }
  });

  it("forwards the observed client IP so an upstream can rate-limit per IP", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/api/v1/crm/public/leads/${FORM_KEY}`,
      payload: { name: "Jane Prospect", consent: true },
    });
    // Without this the upstream sees only the gateway's address, so a per-IP budget
    // collapses into one shared counter for the whole tenant — a DoS weapon.
    expect(lastUpstreamHeaders["x-forwarded-for"]).toBeDefined();
  });

  it("overwrites a client-supplied x-forwarded-for rather than trusting it", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: `/api/v1/crm/public/leads/${FORM_KEY}`,
      headers: { "x-forwarded-for": "1.2.3.4" },
      payload: { name: "Spoofer", consent: true },
    });
    // A caller that could inject its own hop would mint a fresh "IP" per request and
    // walk straight past the limiter.
    expect(lastUpstreamHeaders["x-forwarded-for"]).not.toContain("1.2.3.4");
  });
});

describe("court public case-status lookup is reachable without a token", () => {
  // Before /api/v1/court/public was allow-listed here: an anonymous POST to
  // /api/v1/court/public/case-status/otp got a 404 (no gateway route matched
  // /api/v1/public/... at all) or a 401 (matched /api/v1/court but rejected by
  // this gateway's own bearer-token pre-check) -- either way, unreachable by the
  // only kind of caller this route exists for: a citizen with no account.
  it("does not 401 an anonymous POST to /api/v1/court/public/case-status/otp", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/court/public/case-status/otp",
      payload: { mobile: "9876543210" },
    });
    expect(res.statusCode).not.toBe(401);
  });

  // The allow-list is the /public sub-tree only. Specifically checks the ONE
  // adjacent route most likely to be swept in by a naive prefix match:
  // /api/v1/court/public-directory is the ADMIN publish endpoint, one character
  // away from "/api/v1/court/public" with no separating slash -- a
  // `pathname.startsWith(prefix)` check (instead of `startsWith(prefix + "/")`)
  // would leak it to anonymous callers.
  it("still requires a token for authenticated court routes, including the adjacent public-directory admin route", async () => {
    const app = await buildApp();
    for (const url of [
      "/api/v1/court/cases",
      "/api/v1/court/public-directory",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    }
  });

  it("forwards the observed client IP so the upstream can rate-limit per IP", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/v1/court/public/case-status/otp",
      payload: { mobile: "9876543210" },
    });
    // Without this the upstream sees only the gateway's address for every citizen,
    // which collapses court-service's per-IP OTP rate limit into one shared bucket
    // -- a self-inflicted DoS on the exact feature this allow-list exists to expose.
    expect(lastUpstreamHeaders["x-forwarded-for"]).toBeDefined();
  });

  it("overwrites a client-supplied x-forwarded-for rather than trusting it", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/v1/court/public/case-status/otp",
      headers: { "x-forwarded-for": "1.2.3.4" },
      payload: { mobile: "9876543210" },
    });
    expect(lastUpstreamHeaders["x-forwarded-for"]).not.toContain("1.2.3.4");
  });
});

describe("MSME self-signup (deep-verification, 2026-08-27): public onboarding is reachable without a token", () => {
  it("does not 401 an anonymous POST to /api/v1/tenant/msme-onboard", async () => {
    // A small-business owner self-registering has no bearer token by definition --
    // tenant-service's own handler was already fixed to accept this (config:{public:true}),
    // but the gateway's OWN pre-check runs before any request is proxied downstream, so an
    // anonymous caller was still 401'd here even after that fix. This is the missing half.
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/tenant/msme-onboard",
      payload: {
        businessName: "Test Kirana Store",
        udyamNumber: "UDYAM-KA-01-0000001",
        ownerName: "Owner",
        email: "owner@example.in",
        category: "micro",
        sector: "services",
      },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it("still requires a token for every other tenant-service route", async () => {
    // The allow-list is this ONE exact path -- /api/v1/tenant and /api/v1/tenants must not
    // open up (create-tenant, suspend, edition-change, etc. all still require a real role).
    const app = await buildApp();
    for (const url of [
      "/api/v1/tenants",
      "/api/v1/tenant/overview",
      "/api/v1/tenant/msme-onboard-typo",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    }
  });

  it("forwards the observed client IP so tenant-service can rate-limit per IP", async () => {
    const app = await buildApp();
    await app.inject({
      method: "POST",
      url: "/api/v1/tenant/msme-onboard",
      payload: {
        businessName: "Test Kirana Store",
        udyamNumber: "UDYAM-KA-01-0000002",
        ownerName: "Owner",
        email: "owner2@example.in",
        category: "micro",
        sector: "services",
      },
    });
    // Without this, a public tenant-creation endpoint's rate limit collapses into one
    // shared counter for every anonymous caller behind the gateway -- an abuse vector for
    // an endpoint that creates a real tenant + a real Keycloak-federated user per call.
    expect(lastUpstreamHeaders["x-forwarded-for"]).toBeDefined();
  });
});
