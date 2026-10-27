/**
 * Owner decision D4c #41: POST /execution/close refuses (422) a closure while issues are open or progress is below
 * 100%, unless the work is closed as dropped/closed with a reason approved by a DAO.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, WORK_ID, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const getAward = vi.fn();
const hasPhysicalCompletion = vi.fn();
const hasWorkClosure = vi.fn();
const getClosureFacts = vi.fn();
const listSplits = vi.fn();
const closeWorkCommand = vi.fn(async () => ({ id: "cmd-id", status: "accepted", correlationId: "corr-1" }));
vi.mock("../src/modules/tender/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/repo.js")>();
  return { ...orig, getAward };
});
vi.mock("../src/modules/execution/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/execution/repo.js")>();
  return { ...orig, hasPhysicalCompletion, hasWorkClosure, getClosureFacts };
});
vi.mock("../src/modules/proposal/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/proposal/repo.js")>();
  return { ...orig, listSplits };
});
vi.mock("../src/modules/execution/commands.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/execution/commands.js")>();
  return { ...orig, closeWorkCommand };
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

describe("D4c #41 close guard", () => {
  let app: FastifyInstance;
  beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  const as = (role: string) => ({ authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, [role]))}` });
  const close = (role: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url: "/v1/works/execution/close", headers: as(role), payload: { workId: WORK_ID, ...payload } });

  beforeEach(() => {
    for (const m of [getAward, hasPhysicalCompletion, hasWorkClosure, getClosureFacts, listSplits, closeWorkCommand]) m.mockClear();
    hasWorkClosure.mockResolvedValue(false);
    listSplits.mockResolvedValue([]);
    getAward.mockResolvedValue({ status: "do_finalized" });
    hasPhysicalCompletion.mockResolvedValue(true);
    getClosureFacts.mockResolvedValue({ openIssues: 0, scopes: [] });
  });

  it("422 CLOSURE_BLOCKED for a completion closure with an open issue, naming the blocker", async () => {
    getClosureFacts.mockResolvedValue({ openIssues: 1, scopes: [] });
    const res = await close("dao", { closureType: "completion" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CLOSURE_BLOCKED");
    expect(res.json().message).toMatch(/open issue/i);
    expect(closeWorkCommand).not.toHaveBeenCalled();
  });

  it("422 CLOSURE_BLOCKED for a completion closure below 100% progress", async () => {
    getClosureFacts.mockResolvedValue({ openIssues: 0, scopes: [{ target: 100, achieved: 40 }] });
    const res = await close("works_admin", { closureType: "completion" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CLOSURE_BLOCKED");
    expect(res.json().message).toMatch(/100%/);
  });

  it("202 for a completion closure when nothing blocks", async () => {
    expect((await close("dao", { closureType: "completion" })).statusCode).toBe(202);
    expect(getClosureFacts).toHaveBeenCalledWith(TENANT_A, WORK_ID);
  });

  it("a drop with open issues needs a reason (422 CLOSURE_REASON_REQUIRED)", async () => {
    hasPhysicalCompletion.mockResolvedValue(false);
    getClosureFacts.mockResolvedValue({ openIssues: 3, scopes: [] });
    const res = await close("dao", { closureType: "dropped" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CLOSURE_REASON_REQUIRED");
    expect((await close("dao", { closureType: "dropped", remarks: "  " })).statusCode).toBe(422);
    expect(closeWorkCommand).not.toHaveBeenCalled();
  });

  it("a drop with open issues and a reason needs the DAO: 403 DAO_APPROVAL_REQUIRED for works_admin/do, 202 for dao and super_admin", async () => {
    hasPhysicalCompletion.mockResolvedValue(false);
    getClosureFacts.mockResolvedValue({ openIssues: 3, scopes: [] });
    for (const role of ["works_admin", "do"]) {
      const res = await close(role, { closureType: "dropped", remarks: "Foreclosed" });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("DAO_APPROVAL_REQUIRED");
    }
    expect(closeWorkCommand).not.toHaveBeenCalled();
    expect((await close("dao", { closureType: "dropped", remarks: "Foreclosed" })).statusCode).toBe(202);
    expect((await close("super_admin", { closureType: "dropped", remarks: "Foreclosed" })).statusCode).toBe(202);
  });

  it("a drop of a clean work still needs no reason and no DAO (unchanged)", async () => {
    hasPhysicalCompletion.mockResolvedValue(false);
    expect((await close("works_admin", { closureType: "dropped" })).statusCode).toBe(202);
  });

  it("an already-closed work is still 409 ALREADY_CLOSED (idempotent) and the facts are not even read", async () => {
    hasWorkClosure.mockResolvedValue(true);
    const res = await close("dao", { closureType: "completion" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ALREADY_CLOSED");
    expect(getClosureFacts).not.toHaveBeenCalled();
  });
});
