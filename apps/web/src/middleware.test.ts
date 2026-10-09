import { describe, it, expect } from "vitest";
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
