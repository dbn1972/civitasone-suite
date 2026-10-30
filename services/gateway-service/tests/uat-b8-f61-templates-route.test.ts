/**
 * UAT F61: notification-service serves its template maker-checker lifecycle
 * (POST /v1/templates/:id/submit|approve|reject|publish, GET /v1/templates/commands/:commandId/status)
 * and template locales (/v1/templates/:templateId/locales) under the un-namespaced /v1/templates tree.
 * The gateway had no prefix for it, so every call via /api/v1/templates/... was 404 "no upstream for path".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { resolveRoute } from "../src/registry.js";
import { _test as moduleGuard } from "../src/module-guard.js";

// HS256 test secret comes from vitest.config.ts env, never a literal here.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000f6";
const ACTOR = "cccccccc-3333-4000-8000-000000000f61";
const TEMPLATE = "dddddddd-4444-4000-8000-000000000f61";
const ADMIN = signToken({ sub: ACTOR, tid: TENANT, roles: ["tenant_admin"], sid: "s-f61" }, SECRET, 3600);

let calls: Array<{ url: string; init: RequestInit | undefined }> = [];
beforeEach(() => {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response("{}", { status: 202, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const NOTIFICATION_UPSTREAM = () => resolveRoute("/api/notification/templates")?.route.upstream;

describe("F61: /api/v1/templates reaches notification-service /v1/templates", () => {
  it("resolves to the notification-service upstream, forwarded verbatim", () => {
    const r = resolveRoute(`/api/v1/templates/${TEMPLATE}/approve`);
    expect(r?.route.name).toBe("notification-templates");
    expect(r?.route.upstream).toBe(NOTIFICATION_UPSTREAM());
    expect(r?.route.upstreamPath).toBe("/v1/templates");
    expect(r?.remainder).toBe(`/${TEMPLATE}/approve`);
  });

  it.each([
    ["POST", `/api/v1/templates/${TEMPLATE}/submit`, `/v1/templates/${TEMPLATE}/submit`],
    ["POST", `/api/v1/templates/${TEMPLATE}/approve`, `/v1/templates/${TEMPLATE}/approve`],
    ["POST", `/api/v1/templates/${TEMPLATE}/reject`, `/v1/templates/${TEMPLATE}/reject`],
    ["POST", `/api/v1/templates/${TEMPLATE}/publish`, `/v1/templates/${TEMPLATE}/publish`],
    ["GET", `/api/v1/templates/commands/${TEMPLATE}/status`, `/v1/templates/commands/${TEMPLATE}/status`],
    ["GET", `/api/v1/templates/${TEMPLATE}/locales`, `/v1/templates/${TEMPLATE}/locales`],
  ] as const)("authenticated %s %s is proxied to notification-service %s", async (method, url, upstreamPath) => {
    const app = await buildApp();
    const res = await app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
      ...(method === "POST" ? { payload: JSON.stringify({ reason: "uat f61" }) } : {}),
    });
    expect(res.statusCode).toBe(202);
    const c = calls.find((x) => x.url.endsWith(upstreamPath));
    expect(c, `no upstream call ending ${upstreamPath}: ${calls.map((x) => x.url).join(", ")}`).toBeDefined();
    expect(c?.url.startsWith(`${NOTIFICATION_UPSTREAM()}/`)).toBe(true);
    expect((c?.init?.headers as Record<string, string>)["x-tenant-id"]).toBe(TENANT);
    await app.close();
  });

  it("still requires authentication at the edge", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/api/v1/templates/${TEMPLATE}/approve` });
    expect(res.statusCode).toBe(401);
    expect(calls.filter((c) => c.url.includes("/v1/templates"))).toHaveLength(0);
    await app.close();
  });

  it("is a platform (never module-gated) route, like the other notification prefixes", () => {
    expect(moduleGuard.PLATFORM_ROUTES.has("notification-templates")).toBe(true);
  });

  it("does not shadow other services' template trees or swallow look-alike prefixes", () => {
    expect(resolveRoute("/api/v1/contract/templates/x")?.route.name).toBe("contract");
    expect(resolveRoute("/api/v1/hrms/jd-templates/x")?.route.name).toBe("hrms");
    expect(resolveRoute("/api/v1/notification/experiments")?.route.name).toBe("notification-v1");
    expect(resolveRoute("/api/notification/templates/x")?.route.name).toBe("notification");
    expect(resolveRoute("/api/v1/templatesx/y")).toBeNull();
    expect(resolveRoute("/api/v1/jd-templates/x")).toBeNull();
  });
});
