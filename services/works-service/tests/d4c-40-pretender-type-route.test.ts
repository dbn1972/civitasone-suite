/**
 * Owner decision D4c #40: POST /pre-tender accepts tenderTypeId, refuses one that is not an active tender type of the
 * caller's tenant (422), and passes it on in the command.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, WORK_ID, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const getActiveTenderType = vi.fn();
const preTenderReferenceExists = vi.fn();
vi.mock("../src/modules/tender/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/repo.js")>();
  return { ...orig, getActiveTenderType, preTenderReferenceExists };
});
const hasFinalizedTsForWork = vi.fn();
vi.mock("../src/modules/approval/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/approval/repo.js")>();
  return { ...orig, hasFinalizedTsForWork };
});
const createPreTenderCommand = vi.fn();
vi.mock("../src/modules/tender/commands.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/commands.js")>();
  return { ...orig, createPreTenderCommand };
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

describe("D4c #40 pre-tender tenderTypeId", () => {
  let app: FastifyInstance;
  beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
  afterAll(async () => { await app.close(); });
  const TYPE_ID = "00000000-8888-4000-8000-000000000001";
  const auth = () => ({ authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_operator"]))}` });
  beforeEach(() => {
    for (const m of [getActiveTenderType, preTenderReferenceExists, hasFinalizedTsForWork, createPreTenderCommand]) m.mockReset();
    hasFinalizedTsForWork.mockResolvedValue(true);
    preTenderReferenceExists.mockResolvedValue(false);
    createPreTenderCommand.mockResolvedValue({ id: "x", status: "accepted", correlationId: "c" });
  });
  const post = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/works/tenders/pre-tender", headers: auth(), payload });

  it("accepts a tender type that is an active master of the tenant and forwards the id", async () => {
    getActiveTenderType.mockResolvedValue({ id: TYPE_ID, name: "Open" });
    const res = await post({ workId: WORK_ID, tenderTypeId: TYPE_ID });
    expect(res.statusCode).toBe(202);
    expect(getActiveTenderType).toHaveBeenCalledWith(TENANT_A, TYPE_ID);
    expect(createPreTenderCommand.mock.calls[0]![1]).toMatchObject({ workId: WORK_ID, tenderTypeId: TYPE_ID });
  });

  it("answers 422 INVALID_TENDER_TYPE for an unknown or inactive type and queues nothing", async () => {
    getActiveTenderType.mockResolvedValue(null);
    const res = await post({ workId: WORK_ID, tenderTypeId: TYPE_ID });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_TENDER_TYPE");
    expect(createPreTenderCommand).not.toHaveBeenCalled();
  });

  it("rejects a tenderTypeId that is not a uuid", async () => {
    const res = await post({ workId: WORK_ID, tenderTypeId: "OPEN" });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });

  it("a legacy request with only the text type is unchanged (no master lookup)", async () => {
    const res = await post({ workId: WORK_ID, tenderType: "LIMITED" });
    expect(res.statusCode).toBe(202);
    expect(getActiveTenderType).not.toHaveBeenCalled();
  });
});
