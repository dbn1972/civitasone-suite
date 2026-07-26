/**
 * all-modules-mounted — composition-root smoke test proving that the eight
 * previously built-but-unmounted inspection route modules are now wired into the
 * PRODUCTION Fastify app via buildApp() (src/app.ts).
 *
 * Before this fix, universe / risk / planning / assignment / checklist / sync /
 * evidence / execution routes existed under src/modules/<m>/routes.ts but were
 * never registered, so every HTTP create/read path returned 404 in production
 * even though their command consumers were live in worker.ts (SVC-101/102/103/109
 * were mis-scored "Implemented" for reachable paths that did not actually route).
 *
 * This test does NOT register any route manually — it builds the app exactly as
 * production does and asserts each module's create endpoint MATCHES A ROUTE (i.e.
 * is not a 404 "route not found"). A 202/400/403 all prove the route is mounted
 * and the request reached the handler; only an unmounted route yields 404 here
 * (auth passes because a valid multi-role token is supplied, so 404 cannot come
 * from the auth layer). The heavy POST→consumer→GET persistence + cross-tenant
 * RLS assertions live in each module's dedicated *-routes-integration.test.ts,
 * which likewise now rely on buildApp() mounting the routes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { vi } from "vitest";

// Mock DB so the test runs without a real Postgres connection.
vi.mock("../src/shared/db.js", () => ({
  db: {
    execute: vi.fn(),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
  },
  sqlClient: { end: vi.fn() },
  dbFor: vi.fn(),
  sqlClientFor: vi.fn(),
  tierOf: vi.fn(),
  dbForRead: vi.fn(),
  scopedRead: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
}));

// Mock infra (cache + queue): a resolved publish lets create routes reach 202.
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    put: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    getOrLoad: vi.fn(async (_k: string, loader: () => Promise<unknown>) => loader()),
    invalidate: vi.fn().mockResolvedValue(undefined),
    makeKey: vi.fn((...args: string[]) => args.join(":")),
  },
  queue: {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

const TENANT = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const USER = "11111111-2222-3333-4444-555555555555";
const SECRET = "test_secret_for_civitasone_32chr";

// Broad role set so per-route requireRole() checks pass and cannot mask a mount
// gap as a 403/401 — the only remaining way to get a 404 is an unmounted route.
const ROLES = [
  "inspector",
  "reviewing_officer",
  "supervisor",
  "inspection_admin",
  "tenant_admin",
  "super_admin",
];

function auth(): Record<string, string> {
  const token = signToken({ sub: USER, tid: TENANT, roles: ROLES, sid: "sess-mount" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

// One create/write endpoint per newly-mounted module.
const ENDPOINTS: Array<{ module: string; method: "POST"; url: string }> = [
  { module: "universe", method: "POST", url: "/v1/inspection/entities" },
  { module: "risk", method: "POST", url: "/v1/inspection/risk/models" },
  { module: "planning", method: "POST", url: "/v1/inspection/plans" },
  { module: "assignment", method: "POST", url: "/v1/inspection/assignments" },
  { module: "checklist", method: "POST", url: "/v1/inspection/checklists/templates" },
  { module: "sync", method: "POST", url: "/v1/inspection/sync/packages" },
  { module: "evidence", method: "POST", url: "/v1/inspection/evidence" },
  { module: "execution", method: "POST", url: `/v1/inspection/inspections/${randomUUID()}/transition` },
];

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("all 8 route modules are mounted by the production buildApp()", () => {
  it.each(ENDPOINTS)("$module: $method $url is routed (not 404)", async ({ method, url }) => {
    const res = await app.inject({ method, url, headers: auth(), payload: {} });
    // A mounted route yields 202 (accepted), 400 (validation), or 403 (rbac) —
    // never 404. 404 here means the composition root failed to register the module.
    expect(res.statusCode).not.toBe(404);
  });

  it("a genuinely unknown route still returns 404 (control)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/inspection/this-route-does-not-exist",
      headers: auth(),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
