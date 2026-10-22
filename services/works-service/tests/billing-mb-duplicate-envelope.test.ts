/**
 * GAP-WORKS-BILLING-NEW-MB-03 (W2 works rescan): the duplicate-MB-number rejection must reach the browser in the
 * envelope the REAL error handler produces. Every other billing route test mocks @civitasone/schemas/plugin with a
 * handler that emits a nested `{ error: { code } }`, which is not what the service sends, so a client that read the
 * nested shape passed its tests and silently missed the code in production. This suite deliberately does NOT mock the
 * schema plugin: it asserts the flat `{ code, message, correlationId, retryable }` body the web must parse.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, ACTOR_B, WORK_ID, AWARD_ID, MB_ID, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const getMbByNumber = vi.fn();
const getAwardById = vi.fn();
vi.mock("../src/modules/tender/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/repo.js")>();
  return { ...orig, getAwardById };
});
vi.mock("../src/modules/billing/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/billing/repo.js")>();
  return { ...orig, getMbByNumber };
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
// NOTE: @civitasone/schemas/plugin is intentionally NOT mocked -- the real createFastifyErrorHandler runs.
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

const auth = `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_admin"], ACTOR_B))}`;

describe("POST /v1/works/billing/mb duplicate number -- real error envelope (NEW-MB-03)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });

  it("answers 409 with the FLAT { code, message } envelope, never a nested error.code", async () => {
    getAwardById.mockResolvedValue({ id: AWARD_ID, workId: WORK_ID });
    getMbByNumber.mockResolvedValue({ id: MB_ID });
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/mb", headers: { authorization: auth },
      payload: { workId: WORK_ID, awardId: AWARD_ID, mbNumber: "MB/001" },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("DUPLICATE_MB_NUMBER");
    expect(typeof body.message).toBe("string");
    expect(body.error).toBeUndefined();
  });

  it("looks the number up trimmed, so stray whitespace cannot dodge the uniqueness check", async () => {
    getAwardById.mockResolvedValue({ id: AWARD_ID, workId: WORK_ID });
    getMbByNumber.mockClear();
    getMbByNumber.mockResolvedValue({ id: MB_ID });
    const res = await app.inject({
      method: "POST", url: "/v1/works/billing/mb", headers: { authorization: auth },
      payload: { workId: WORK_ID, awardId: AWARD_ID, mbNumber: "  MB/001  " },
    });
    expect(res.statusCode).toBe(409);
    expect(getMbByNumber).toHaveBeenCalledWith(TENANT_A, WORK_ID, "MB/001");
  });
});
