/**
 * Regression test: POST /v1/works/execution/close used to accept ANY
 * closureType for ANY work and always return 202 — closureEligibility()
 * and parentSplitConsistency() were enforced only inside the async
 * consumer (execution/consumer.ts COMMANDS.workClose), which silently
 * `return`s (no throw, no event, no audit trail) when the request doesn't
 * match the work's real eligibility. The frontend
 * (works/execution/[workId]/ExecutionActions.tsx) shows an unconditional
 * "Work closed" success toast on any 202, so an ineligible close request
 * looked identical to a real one to the officer who submitted it, with
 * nothing ever persisted. Same anti-pattern already found and fixed once
 * in this file for recordProgress ("Bug #3"). Fix: enforce the same rule
 * synchronously in the route (see execution/routes.ts POST .../close).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { TENANT_A, WORK_ID, bearerToken, jwtPayload } from "./fixtures/works-fixtures.js";

const getAward = vi.fn();
const hasPhysicalCompletion = vi.fn();
const listSplits = vi.fn();
// closeWorkCommand resolves to an Accepted shape ({id, status, correlationId})
// — sendAccepted (packages/schemas/src/validate.ts) zod-validates against
// exactly that before replying, so the mock must match it or every "happy
// path" 202 assertion below would itself 500.
const closeWorkCommand = vi.fn(async () => ({ id: "cmd-id", status: "accepted", correlationId: "corr-1" }));

vi.mock("../src/modules/tender/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/repo.js")>();
  return { ...orig, getAward };
});
vi.mock("../src/modules/execution/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/execution/repo.js")>();
  return { ...orig, hasPhysicalCompletion };
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

function closeReq(app: FastifyInstance, closureType: string) {
  return app.inject({
    method: "POST",
    url: "/v1/works/execution/close",
    headers: { authorization: `Bearer ${bearerToken(jwtPayload(TENANT_A, ["works_admin"]))}` },
    payload: { workId: WORK_ID, closureType },
  });
}

describe("POST /v1/works/execution/close — enforces eligibility synchronously (was: silent no-op)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
  });
  afterAll(async () => { await app.close(); });
  beforeEach(() => {
    getAward.mockReset();
    hasPhysicalCompletion.mockReset();
    listSplits.mockReset();
    closeWorkCommand.mockClear();
    listSplits.mockResolvedValue([]);
  });

  it("422s a 'completion' close for a work that has an agreement but no physical-completion cert (real eligibility: dropped)", async () => {
    getAward.mockResolvedValue({ status: "dao_finalized" });
    hasPhysicalCompletion.mockResolvedValue(false);
    const res = await closeReq(app, "completion");
    expect(res.statusCode).toBe(422);
    expect(closeWorkCommand).not.toHaveBeenCalled(); // previously: 202 + silently dropped in the consumer
  });

  it("accepts 'dropped' for that same work (matches real eligibility)", async () => {
    getAward.mockResolvedValue({ status: "dao_finalized" });
    hasPhysicalCompletion.mockResolvedValue(false);
    const res = await closeReq(app, "dropped");
    expect(res.statusCode).toBe(202);
    expect(closeWorkCommand).toHaveBeenCalledTimes(1);
  });

  it("accepts 'completion' once a physical-completion cert exists", async () => {
    getAward.mockResolvedValue({ status: "do_finalized" });
    hasPhysicalCompletion.mockResolvedValue(true);
    const res = await closeReq(app, "completion");
    expect(res.statusCode).toBe(202);
  });

  it("422s 'dropped' once physical completion is recorded (no longer eligible to drop)", async () => {
    getAward.mockResolvedValue({ status: "do_finalized" });
    hasPhysicalCompletion.mockResolvedValue(true);
    const res = await closeReq(app, "dropped");
    expect(res.statusCode).toBe(422);
  });

  it("409s when a split is still open, even if the parent itself is eligible", async () => {
    getAward.mockResolvedValue(null); // pre-agreement -> eligible for closed/dropped
    hasPhysicalCompletion.mockResolvedValue(false);
    listSplits.mockResolvedValue([{ id: "s1", status: "active" }]);
    const res = await closeReq(app, "closed");
    expect(res.statusCode).toBe(409);
    expect(closeWorkCommand).not.toHaveBeenCalled();
  });

  it("accepts a pre-agreement 'closed' once all splits are closed", async () => {
    getAward.mockResolvedValue(null);
    hasPhysicalCompletion.mockResolvedValue(false);
    listSplits.mockResolvedValue([{ id: "s1", status: "closed" }]);
    const res = await closeReq(app, "closed");
    expect(res.statusCode).toBe(202);
  });
});
