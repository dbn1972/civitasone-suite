/**
 * GAP-WORKS-CLOSURE-02 / CLOSURE-05: the closure register enforces the reader
 * roles and now enriches each row with an agreement number — but ONLY when the
 * work has exactly one finalized award (unambiguous). An ambiguous (multiple
 * distinct) or absent case stays null so a contract is never misidentified.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, WORK_ID, WORK_ID_B, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const listClosures = vi.fn();
const finalizedAgreementByWorkIds = vi.fn();

vi.mock("../src/modules/execution/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/execution/repo.js")>();
  return { ...orig, listClosures };
});
vi.mock("../src/modules/tender/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/repo.js")>();
  return { ...orig, finalizedAgreementByWorkIds };
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
vi.mock("@civitasone/schemas/plugin", () => ({
  registerSchemaErrorHandler: (app: any, HttpError: any) => {
    app.setErrorHandler((err: any, _req: any, reply: any) => {
      if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code } });
      return reply.status(500).send({ error: { code: "INTERNAL" } });
    });
  },
}));
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

describe("GET /v1/works/closure", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });

  const auth = (roles: string[]) => ({ authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, roles))}` });

  it("CLOSURE-05: is forbidden without a reader role", async () => {
    listClosures.mockResolvedValue([]);
    finalizedAgreementByWorkIds.mockResolvedValue(new Map());
    const res = await app.inject({ method: "GET", url: "/v1/works/closure?pageSize=100", headers: auth(["citizen"]) });
    expect(res.statusCode).toBe(403);
    expect(listClosures).not.toHaveBeenCalled();
  });

  it("CLOSURE-02: attaches the agreement number for an unambiguous work, null for an ambiguous one", async () => {
    listClosures.mockResolvedValue([
      { id: "cl1", workId: WORK_ID, closureType: "closed", closedDate: "2026-01-01", remarks: null, version: 1, workNumber: "WRK-1", description: "A" },
      { id: "cl2", workId: WORK_ID_B, closureType: "dropped", closedDate: "2026-01-02", remarks: null, version: 1, workNumber: "WRK-2", description: "B" },
    ]);
    // WORK_ID has one finalized award -> agreement; WORK_ID_B is ambiguous -> absent.
    finalizedAgreementByWorkIds.mockResolvedValue(new Map([[WORK_ID, "AGR/2026/001"]]));
    const res = await app.inject({ method: "GET", url: "/v1/works/closure?pageSize=100", headers: auth(["works_viewer"]) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.find((r: { workId: string }) => r.workId === WORK_ID).agreementNumber).toBe("AGR/2026/001");
    expect(data.find((r: { workId: string }) => r.workId === WORK_ID_B).agreementNumber).toBeNull();
  });
});
