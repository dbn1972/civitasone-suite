import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

// GAP-SANDBOX-HOME-01: anonymous visitors must reach /sandbox (and the demo
// sign-in route) without being redirected to /auth/login. These assertions
// fail on the old PUBLIC list, which omitted /sandbox and /api/sandbox.

function anonReq(path: string): NextRequest {
  return new NextRequest(new URL(`https://demo.test${path}`));
}

describe("middleware public sandbox access", () => {
  it("lets an anonymous GET /sandbox through without redirect", () => {
    const res = middleware(anonReq("/sandbox"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets anonymous GET /api/sandbox/enter through without redirect", () => {
    const res = middleware(anonReq("/api/sandbox/enter?role=citizen"));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects an anonymous visitor on a protected route", () => {
    const res = middleware(anonReq("/dashboard"));
    expect(res.status).toBe(307);
    const loc = res.headers.get("location");
    expect(loc).toContain("/auth/login");
    expect(loc).toContain("next=%2Fdashboard");
  });
});

// W0 defect 3: /contact, /api/contact and /.well-known/* must be reachable
// anonymously (the matcher covers them, and no proxy in infra/ exempts them).
describe("middleware public contact + well-known access", () => {
  it.each(["/contact", "/api/contact", "/.well-known/security.txt"])("lets an anonymous request to %s through", (path) => {
    const res = middleware(anonReq(path));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects an anonymous visitor on a private path", () => {
    const res = middleware(anonReq("/finance/vouchers"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/login");
  });
});

// Follow-up to W0 defect 3: the rest of the marketing site (/, /pricing, /docs,
// /docs/api, /docs/<slug>, /sandbox) had the same problem as /contact. The route
// list below is read from app/(marketing) itself, so a new marketing page that is
// not made public fails this test instead of silently redirecting visitors to login.
function marketingRoutes(): string[] {
  const root = join(__dirname, "app", "(marketing)");
  const out: string[] = [];
  const walk = (dir: string, url: string) => {
    if (existsSync(join(dir, "page.tsx")) || existsSync(join(dir, "route.ts"))) out.push(url || "/");
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const seg = /^\[.+\]$/.test(e.name) ? "sample-slug" : e.name;
      walk(join(dir, e.name), `${url}/${seg}`);
    }
  };
  walk(root, "");
  return out;
}

describe("middleware public marketing site", () => {
  const routes = marketingRoutes();

  it("found the marketing routes (guards the walker itself)", () => {
    expect(routes).toEqual(expect.arrayContaining(["/", "/pricing", "/docs", "/docs/api", "/docs/sample-slug", "/contact", "/sandbox"]));
  });

  it.each(routes)("lets an anonymous visitor reach %s without a redirect", (path) => {
    const res = middleware(anonReq(path));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects private paths, including ones that only share a prefix with a public path", () => {
    for (const path of ["/finance/vouchers", "/dashboard", "/documents", "/docsx", "/pricingx", "/pricing-admin"]) {
      const res = middleware(anonReq(path));
      expect(res.status, path).toBe(307);
      expect(res.headers.get("location"), path).toContain("/auth/login");
    }
  });

  it("does not treat '/' as a prefix: a deep private path stays private", () => {
    const res = middleware(anonReq("/hr/employees"));
    expect(res.status).toBe(307);
  });
});

// GAP2-SHELL-CSP-01: style-src / style-src-elem keep 'unsafe-inline' because
// ~28 components render inline <style> elements without a nonce. Inline style
// ATTRIBUTES are pinned via style-src-attr. Keywords MUST be single-quoted.
describe("middleware CSP style policy (GAP2-SHELL-CSP-01)", () => {
  function cspOf(path: string): string {
    return middleware(anonReq(path)).headers.get("Content-Security-Policy") ?? "";
  }

  it("keeps inline <style> elements allowed (components render them without a nonce)", () => {
    const csp = cspOf("/sandbox");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src-elem 'self' 'unsafe-inline'");
  });

  it("keeps inline style ATTRIBUTES working via style-src-attr only", () => {
    const csp = cspOf("/sandbox");
    expect(csp).toContain("style-src-attr 'unsafe-inline'");
  });

  it("keeps scripts strict (nonce, no unsafe-inline)", () => {
    const csp = cspOf("/sandbox");
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
});

// GAP-LOCATIONS-MAPS-02: the map iframe is a sandboxed srcdoc document, so its
// requests for the self-hosted Leaflet bundle carry no session cookie. They must
// not be bounced to the login page, and the CSP must allow the base-map tiles.
describe("middleware map assets", () => {
  it.each(["/vendor/leaflet/leaflet.js", "/vendor/leaflet/leaflet.css", "/vendor/leaflet/images/marker-icon.png", "/maps/civitas-map.js"])(
    "lets an anonymous request for %s through",
    (path) => {
      const res = middleware(anonReq(path));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    },
  );

  it("does not make other /vendor or /maps paths public", () => {
    for (const path of ["/vendor/other/x.js", "/maps/secret"]) expect(middleware(anonReq(path)).status).toBe(307);
  });

  it("allows the configured base-map tile origin in img-src", () => {
    const csp = middleware(anonReq("/auth/login")).headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/img-src 'self' data: blob: https:\/\/[^;]*tile/);
  });
});


// V4-A-04: PUBLIC entries must match on a path-segment boundary, otherwise any
// future route that merely shares leading letters (/contacts, /authz, /verifyx)
// would silently skip the session check.
describe("middleware public allow-list segment boundary (V4-A-04)", () => {
  it.each(["/contacts", "/api/contacts", "/authz", "/api/authz", "/verifyx", "/careers-admin", "/api/careersX", "/sandboxes", "/api/metricsx"])(
    "keeps %s private (redirects an anonymous visitor)",
    (path) => {
      const res = middleware(anonReq(path));
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/auth/login");
    },
  );

  it.each([
    "/auth",
    "/auth/login",
    "/api/auth/callback",
    "/careers",
    "/careers/jobs/1",
    "/api/careers/apply",
    "/verify",
    "/verify/abc",
    "/sandbox",
    "/api/sandbox/enter",
    "/contact",
    "/api/contact",
    "/api/metrics",
    "/_next/static/chunks/a.js",
    "/favicon.ico",
    "/sw.js",
    "/.well-known/security.txt",
  ])("still lets %s through anonymously", (path) => {
    const res = middleware(anonReq(path));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

// V4-A-09: logout must work without a valid access cookie, and the offline
// fallback page (precached by sw.js) must render without auth.
describe("middleware /logout and /offline are public (V4-A-09)", () => {
  it.each(["/logout", "/offline"])("lets an anonymous request to %s through", (path) => {
    const res = middleware(anonReq(path));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(["/logoutx", "/offline-admin"])("does not make %s public", (path) => {
    expect(middleware(anonReq(path)).status).toBe(307);
  });
});
