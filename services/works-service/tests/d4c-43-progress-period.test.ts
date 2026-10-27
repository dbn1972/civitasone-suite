/**
 * Owner decision D4c #43: POST /execution/progress refuses (409) a second ordinary entry for the same scope and month;
 * a correction (negative, with a reason) is still accepted.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const getWorkScope = vi.fn();
const listScopeProgress = vi.fn();
const recordProgressCommand = vi.fn(async () => ({ id: "cmd", status: "accepted", correlationId: "c" }));
vi.mock("../src/modules/execution/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/execution/repo.js")>();
  return { ...orig, getWorkScope, listScopeProgress };
});
vi.mock("../src/modules/execution/commands.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/execution/commands.js")>();
  return { ...orig, recordProgressCommand };
});

vi.mock("@civitasone/db", () => ({
  createTenantDb: () => ({
    sqlClient: { end: vi.fn() },
    db: { transaction: vi.fn(), select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }) },
    dbFor: vi.fn(), sqlClientFor: vi.fn(), tierOf: vi.fn(), dbForRead: vi.fn(),
  }),
  createTenantTxHook: () => async () => {},
  tenantStorage: { enterWith: vi.fn() },
  runWithTenant: vi.fn((_t: string, fn: Function) => fn()),
}));
vi.mock("@civitasone/cache", () => ({
  Cache: class { getOrLoad(_k: string, fn: Function) { return fn(); } invalidate() { return Promise.resolve(); } },
}));
vi.mock("@civitasone/queue", () => ({
  createQueue: () => ({ publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() }),
  MemoryQueue: class { publish = vi.fn(); subscribe = vi.fn(); start = vi.fn(); stop = vi.fn(); },
}));
vi.mock("@civitasone/observability", () => ({ registerOpsRoutes: vi.fn(), dbPing: vi.fn() }));
vi.mock("@civitasone/outbox", () => ({
  outboxMessages: {}, processed: {}, outboxSchema: {},
  enqueue: vi.fn(), markProcessed: vi.fn(), startRelay: vi.fn(() => setInterval(() => {}, 999999)),
}));
// NOTE: @civitasone/schemas/plugin is intentionally NOT mocked -- the real createFastifyErrorHandler runs, so every
// `.json().code` below is read from the FLAT { code, message, correlationId, retryable } body the service really sends.
vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: Object.assign(async (app: any) => {
    app.decorateRequest("ctx", undefined);
    app.addHook("onRequest", async (req: any) => {
      const auth = req.headers?.authorization;
      if (!auth) return;
      const [, body] = auth.replace("Bearer ", "").split(".");
      const payload = JSON.parse(Buffer.from(body, "base64url").toString());
      (req as any).ctx = { tenantId: payload.tid, actorId: payload.sub, roles: payload.roles || [], correlationId: "c", sessionId: "s", actorType: "user" };
    });
  }, { [Symbol.for("skip-override")]: true, [Symbol.for("fastify.display-name")]: "civitasone-auth" }),
}));
vi.mock("@civitasone/auth/context", () => {
  class AuthContextError extends Error { status: number; code: string; constructor(s: number, c: string, m: string) { super(m); this.status = s; this.code = c; } }
  return {
    resolveServiceContext: (req: any) => { if (!req.ctx) throw new AuthContextError(401, "UNAUTHENTICATED", "missing"); return req.ctx; },
    AuthContextError,
  };
});
vi.mock("@civitasone/auth", () => ({
  signToken: vi.fn(),
  hasAnyRole: (ctx: any, roles: string[]) => roles.some((r: string) => ctx.roles?.includes(r)),
}));

describe("D4c #43 progress period uniqueness", () => {
  let app: FastifyInstance;
  beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  const SCOPE = "00000000-4444-4000-8000-0000000000a1";
  const post = (payload: Record<string, unknown>) => app.inject({
    method: "POST", url: "/v1/works/execution/progress",
    headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_operator"]))}` },
    payload: { workScopeId: SCOPE, month: 5, year: 2026, ...payload },
  });
  beforeEach(() => {
    for (const m of [getWorkScope, listScopeProgress, recordProgressCommand]) m.mockClear();
    getWorkScope.mockResolvedValue({ id: SCOPE, targetValue: "1000" });
    listScopeProgress.mockResolvedValue([{ month: 5, year: 2026, currentAchievement: "10", entryKind: "progress" }]);
  });

  it("409 DUPLICATE_PROGRESS_PERIOD for a second ordinary entry in the month; nothing queued", async () => {
    const res = await post({ currentAchievement: 5 });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_PROGRESS_PERIOD");
    expect(recordProgressCommand).not.toHaveBeenCalled();
  });

  it("the message says how to fix a figure (a negative correction with a reason)", async () => {
    expect((await post({ currentAchievement: 5 })).json().message).toMatch(/correction/i);
  });

  it("a correction with a reason is accepted in the same month", async () => {
    const res = await post({ currentAchievement: -3, correctionReason: "Re-measured" });
    expect(res.statusCode).toBe(202);
  });

  it("another month is accepted", async () => {
    expect((await post({ currentAchievement: 5, month: 6 })).statusCode).toBe(202);
  });

  it("a month that so far holds only a correction (or a legacy duplicate) does not count as taken by a correction", async () => {
    listScopeProgress.mockResolvedValue([{ month: 5, year: 2026, currentAchievement: "-2", entryKind: "correction" }]);
    expect((await post({ currentAchievement: 5 })).statusCode).toBe(202);
  });

  it("works for a scope with no target too (the check is not tied to the target cap)", async () => {
    getWorkScope.mockResolvedValue({ id: SCOPE, targetValue: null });
    expect((await post({ currentAchievement: 5 })).statusCode).toBe(409);
  });
});
