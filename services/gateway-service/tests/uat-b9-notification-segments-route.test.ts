/**
 * UAT bundle 9 (B9-gw): /api/v1/segments (registry "notification-segments", the web campaign
 * composer) is served by notification-service like /api/notification, /api/v1/notification and
 * /api/v1/templates, but it was missing from the module guard's PLATFORM_ROUTES. As an unmapped
 * route it 403'd (MODULE_DISABLED) every tenant in composition `enforce` mode, while its sibling
 * notification routes always pass.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { resolveRoute } from "../src/registry.js";
import { checkModuleEnabled, _test as moduleGuard } from "../src/module-guard.js";

// HS256 test secret comes from vitest.config.ts env, never a literal here.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000b9";
const ACTOR = "cccccccc-3333-4000-8000-0000000000b9";
const ADMIN = signToken({ sub: ACTOR, tid: TENANT, roles: ["tenant_admin"], sid: "s-b9" }, SECRET, 3600);
const NOTIFICATION_ROUTES = ["notification", "notification-v1", "notification-templates", "notification-segments"];

let calls: string[] = [];
beforeEach(() => {
  moduleGuard.moduleCache.clear();
  moduleGuard.lastKnownMode.clear();
  moduleGuard.lastKnownAllowList.clear();
  calls = [];
  vi.stubEnv("COMPOSITION_ENFORCEMENT", "on");
  // admin-service answers: an enforce tenant with NO module entitlements; other upstreams answer 200.
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(String(url));
    const body = String(url).includes("/v1/segments") ? { data: [] } : { configured: true, mode: "enforce", data: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

type FakeReply = { _code: number; code: (n: number) => FakeReply; header: () => FakeReply; send: () => FakeReply };
function fakeReply(): FakeReply {
  const r = { _code: 200 } as FakeReply;
  r.code = (n: number) => ((r._code = n), r);
  r.header = () => r;
  r.send = () => r;
  return r;
}
const fakeReq = () => ({ headers: { "x-tenant-id": TENANT }, id: "req-b9", log: { warn() {} } }) as unknown as FastifyRequest;

describe("B9-gw: notification-segments is a never-gated platform route", () => {
  it("is registered on the notification-service upstream", () => {
    const r = resolveRoute("/api/v1/segments");
    expect(r?.route.name).toBe("notification-segments");
    expect(r?.route.upstream).toBe(resolveRoute("/api/notification/templates")?.route.upstream);
  });

  it.each(NOTIFICATION_ROUTES)("%s is in PLATFORM_ROUTES like its notification siblings", (name) => {
    expect(moduleGuard.PLATFORM_ROUTES.has(name)).toBe(true);
  });

  it.each(NOTIFICATION_ROUTES)("an enforce tenant with no entitlements is allowed on %s", async (name) => {
    const reply = fakeReply();
    expect(await checkModuleEnabled(fakeReq(), reply as unknown as FastifyReply, name)).toBe(true);
    expect(reply._code).toBe(200);
  });

  it("GET /api/v1/segments is proxied (not 403 MODULE_DISABLED) for an enforce tenant", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/segments", headers: { authorization: `Bearer ${ADMIN}` } });
    expect(res.statusCode, res.body).toBe(200);
    expect(calls.some((u) => u.endsWith("/v1/segments"))).toBe(true);
    await app.close();
  });
});
