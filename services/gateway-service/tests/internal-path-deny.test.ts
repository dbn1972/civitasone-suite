/**
 * UAT Phase 2 security review #2446 (3): the internal-path denylist covered
 * only /workflow/internal. It is now generic: every service's `internal`
 * route group (procurement vendor-names, payroll, hrms, identity, ml, ...) is
 * refused for external traffic and nothing is forwarded upstream, whatever
 * credentials or x-internal headers the caller sends. Ordinary routes (and
 * paths that merely contain "internal" inside a segment) still proxy.
 * Service-to-service calls never go through the gateway (they call the
 * service directly with the service secret) — see the procurement-service
 * test uat-p2-internal-vendor-names.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { isInternalServicePath } from "../src/internal-path.js";

const TOKEN = signToken({ sub: "actor-1", tid: "tenant-1", roles: ["super_admin", "service_account"] }, process.env.JWT_SECRET as string, 3600);
let upstreamCalls: string[] = [];

beforeEach(() => {
  upstreamCalls = [];
  vi.stubGlobal("fetch", async (url: string) => {
    upstreamCalls.push(String(url));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("isInternalServicePath", () => {
  it.each([
    "/api/v1/procurement/internal/vendor-names",
    "/api/v1/payroll/internal/locked-through",
    "/api/v1/hrms/internal/employee-summaries",
    "/api/v1/workflow/internal/open-task-refs",
    "/api/v1/ml/internal/delay-forecast/simulate",
    "/api/identity/internal/user-summaries",
    "/api/v1/procurement/internal",
    "/API/V1/Procurement/Internal/vendor-names",
  ])("matches %s", (p) => expect(isInternalServicePath(p)).toBe(true));

  it.each([
    "/api/v1/procurement/vendors",
    "/api/v1/helpdesk/internal-tickets",
    "/api/v1/procurement/vendors/internal",
    "/internal/module-cache/invalidate",
  ])("does not match %s", (p) => expect(isInternalServicePath(p)).toBe(false));
});

describe("gateway deny: /v1/<service>/internal/*", () => {
  it.each([
    ["GET", "/api/v1/procurement/internal/vendor-names?ids=00000000-0000-4000-8000-000000000001"],
    ["GET", "/api/v1/payroll/internal/locked-through"],
    ["GET", "/api/v1/hrms/internal/employee-summaries"],
    ["GET", "/api/identity/internal/user-summaries"],
    ["POST", "/api/v1/workflow/internal/open-task-refs"],
  ])("%s %s -> 403 even with a valid token and x-internal headers, nothing forwarded", async (method, url) => {
    const app = await buildApp();
    const res = await app.inject({
      method: method as "GET" | "POST", url,
      headers: { authorization: `Bearer ${TOKEN}`, "x-internal": "1", "x-tenant-id": "tenant-1", "x-service-secret": "guess" },
      ...(method === "POST" ? { payload: {} } : {}),
    });
    expect([403, 404]).toContain(res.statusCode);
    expect(res.statusCode).toBe(403);
    expect(upstreamCalls).toEqual([]);
    await app.close();
  });

  it("still proxies an ordinary procurement route", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/procurement/vendors", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.statusCode).not.toBe(403);
    expect(upstreamCalls.length).toBeGreaterThan(0);
    await app.close();
  });
});
