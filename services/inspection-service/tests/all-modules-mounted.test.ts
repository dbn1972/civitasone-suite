/**
 * all-modules-mounted — composition-root smoke test proving that every
 * inspection route module is wired into the PRODUCTION Fastify app via
 * buildApp() (src/app.ts).
 *
 * This exact bug shape has now recurred twice. First: universe / risk /
 * planning / assignment / checklist / sync / evidence / execution routes
 * existed under src/modules/<m>/routes.ts but were never registered, so
 * every HTTP create/read path 404'd in production even though their command
 * consumers were live in worker.ts (SVC-101/102/103/109 were mis-scored
 * "Implemented" for reachable paths that did not actually route) — this
 * test was written to guard against exactly that. Second: encroachment and
 * illegal-construction were later built completely (routes, commands,
 * domain, repo, schema) — including passing this exact test's own
 * ENDPOINTS-completeness intent — but were never added to this file's
 * ENDPOINTS array, so when their app.ts registration, worker.ts consumer
 * registration, and even their CREATE TABLE migrations all went missing
 * too, nothing here caught it. Confirmed live before the fix: every
 * encroachment/illegal-construction route 404'd, and every command
 * commands.ts published had no subscriber anywhere.
 *
 * ENDPOINTS below now covers every module actually registered in app.ts
 * (grep `await app.register(register` there to re-verify this stays
 * exhaustive), not just the original eight, so a third recurrence of "built
 * but never mounted" — for any module — fails this test instead of quietly
 * shipping.
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
// Verified this still holds for the two newly-added modules below:
// encroachment/illegal-construction's ADMIN_ROLES/WRITE_ROLES both include
// inspection_admin, tenant_admin, and super_admin, all already in this list.
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

// One create/write endpoint per mounted module — kept exhaustive against
// every `await app.register(register...)` call in app.ts, not just the
// original eight (see the file-header comment for why that gap mattered).
const ENDPOINTS: Array<{ module: string; method: "POST" | "GET"; url: string }> = [
  { module: "universe", method: "POST", url: "/v1/inspection/entities" },
  { module: "risk", method: "POST", url: "/v1/inspection/risk/models" },
  { module: "planning", method: "POST", url: "/v1/inspection/plans" },
  { module: "assignment", method: "POST", url: "/v1/inspection/assignments" },
  { module: "checklist", method: "POST", url: "/v1/inspection/checklists/templates" },
  { module: "sync", method: "POST", url: "/v1/inspection/sync/packages" },
  { module: "evidence", method: "POST", url: "/v1/inspection/evidence" },
  { module: "execution", method: "POST", url: `/v1/inspection/inspections/${randomUUID()}/transition` },
  { module: "capa", method: "POST", url: "/v1/inspection/capa" },
  { module: "enforcement", method: "POST", url: "/v1/inspection/enforcement/penalty-rates" },
  { module: "licence", method: "POST", url: "/v1/inspection/licences" },
  { module: "survey", method: "POST", url: "/v1/inspection/surveys" },
  { module: "telemetry", method: "POST", url: "/v1/inspection/telemetry/devices" },
  { module: "findings", method: "POST", url: "/v1/inspection/findings" },
  { module: "dashboard", method: "GET", url: "/v1/inspection/dashboard" },
  { module: "reports", method: "POST", url: "/v1/inspection/reports" },
  // The two modules this PR fixes — built completely, never mounted (see
  // file-header comment).
  { module: "encroachment", method: "POST", url: "/v1/inspection/encroachment/complaints" },
  { module: "illegal-construction", method: "POST", url: "/v1/inspection/illegal-construction/cases" },
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

describe("every route module registered in app.ts is mounted by the production buildApp()", () => {
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

  // ENDPOINTS above is a hand-synced literal with nothing that previously
  // cross-checked it against app.ts's actual registrations — it could only
  // ever catch a mounted-but-broken route, never a forgotten ENDPOINTS
  // entry for a module that *is* registered (which is exactly how
  // encroachment/illegal-construction went unnoticed even after this file
  // already existed for the original eight). This closes that gap for the
  // one thing both files agree on structurally: how many modules app.ts
  // registers. Not a substitute for keeping ENDPOINTS itself in sync by
  // hand, but a real tripwire against silently losing a registration —
  // whoever adds module #19 will see this fail if they forget module #19's
  // own row above, immediately, in this same test file.
  it("ENDPOINTS has one row per module actually registered in app.ts", async () => {
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const appTsPath = fileURLToPath(new URL("../src/app.ts", import.meta.url));
    const appTsSource = await readFile(appTsPath, "utf8");
    const registrations = appTsSource.match(/await app\.register\(register\w+Routes\)/g) ?? [];
    expect(ENDPOINTS.length).toBe(registrations.length);
  });
});
