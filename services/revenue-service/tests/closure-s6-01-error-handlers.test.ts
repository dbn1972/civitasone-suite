/**
 * CLOS-S6-01 regression — module error handlers must (a) pass Fastify-native
 * 4xx (e.g. malformed JSON) through as 4xx instead of 500, and (b) log
 * unexpected errors before returning the generic 500 INTERNAL envelope.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET as string; // set by vitest.config.ts
const TENANT_ID = "t1111111-1111-1111-1111-111111111111";
const USER_ID = "u1111111-1111-1111-1111-111111111111";
const AUTH = {
  authorization: `Bearer ${signToken({ sub: USER_ID, tid: TENANT_ID, roles: ["revenue_admin"], sid: "s1" }, SECRET, 3600)}`,
  "content-type": "application/json",
};

const logSpy = vi.hoisted(() => ({ error: vi.fn() }));

// Inject a capturing logger into Fastify so req.log.error calls are observable.
vi.mock("fastify", async (importOriginal) => {
  const orig = await importOriginal<typeof import("fastify")>();
  const mk = (): any => {
    const l: any = {
      level: "info", fatal: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(),
      silent: vi.fn(), error: logSpy.error,
    };
    l.child = () => l;
    return l;
  };
  const wrapped = (opts: any) => orig.default({ ...opts, logger: mk() });
  return { ...orig, default: wrapped };
});

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})) },
  sqlClient: { end: vi.fn() },
  dbFor: vi.fn(), sqlClientFor: vi.fn(), tierOf: vi.fn(), dbForRead: vi.fn(),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { put: vi.fn(), get: vi.fn().mockResolvedValue(null), getOrLoad: vi.fn().mockResolvedValue([]), invalidate: vi.fn() },
  queue: {
    publish: vi.fn().mockRejectedValue(new Error("boom: queue down")),
    subscribe: vi.fn(), start: vi.fn(), stop: vi.fn(),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

vi.mock("../src/shared/context.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/shared/context.js")>();
  return {
    ...original,
    resolveContext: (req: any) => {
      const ctx = req.ctx;
      if (!ctx || ctx.actorId === "system" || ctx.actorId === "anonymous") {
        throw new original.HttpError(401, "UNAUTHENTICATED", "missing authentication");
      }
      return { actorId: ctx.actorId, tenantId: ctx.tenantId, roles: ctx.roles ?? [], sessionId: ctx.sessionId ?? "", correlationId: ctx.correlationId ?? req.id };
    },
  };
});

let app: FastifyInstance;
beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});
afterAll(async () => { await app.close(); });

const MODULE_ROUTES: Array<[string, string, string]> = [
  ["analytics", "POST", "/v1/revenue/analytics/forecast"],
  ["arrears", "POST", "/v1/revenue/instalments"],
  ["bbps", "POST", "/v1/revenue/bbps/fetch-bill"],
  ["billing", "POST", "/v1/revenue/bills/generate"],
  ["collection", "POST", "/v1/revenue/receipts"],
  ["rate-engine", "POST", "/v1/revenue/rate-heads"],
  ["trade-license", "POST", "/v1/revenue/trade-licenses"],
];

describe("CLOS-S6-01 malformed JSON is a 4xx, not 500", () => {
  it.each(MODULE_ROUTES)("%s: %s %s", async (_m, method, url) => {
    const res = await app.inject({ method: method as "POST", url, headers: AUTH, payload: "{bad" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).not.toContain("Unexpected");
  });
});

describe("CLOS-S6-01 unexpected errors are logged then returned as generic 500", () => {
  it("rate-engine: queue failure -> 500 INTERNAL and req.log.error called", async () => {
    logSpy.error.mockClear();
    const res = await app.inject({
      method: "POST", url: "/v1/revenue/rate-heads", headers: AUTH,
      payload: { code: "PT", name: "Property Tax", category: "property_tax" },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: "INTERNAL", message: "internal server error" } });
    expect(logSpy.error).toHaveBeenCalled();
    expect(JSON.stringify(res.json())).not.toContain("boom");
  });
});
