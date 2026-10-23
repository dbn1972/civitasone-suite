/**
 * CLOS-S6-04 regression - works-service uuid path-param validation.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const TENDER_PAGE = Array.from({ length: 100 }, (_v, i) => ({
  id: `00000000-1111-4000-8000-0000000001${String(i).padStart(2, "0")}`,
  workId: null,
  tenderTypeId: null,
  tenderAmountMinor: 0n,
  openingDate: null,
  approvingAuthorityId: null,
  contractorClassId: null,
  remarks: null,
  createdAt: new Date(),
  workNumber: `WRK/${i}`,
}));

const awardStore: Record<string, { id: string; status: string; workId: string; contractorId: string | null; contractorName: string; acceptedAmountMinor: bigint; daoFinalizedAt: Date | null; doFinalizedAt: Date | null }> = {};
const tenderById: Record<string, unknown> = {
  "00000000-1111-4000-8000-000000000250": {
    id: "00000000-1111-4000-8000-000000000250",
    workId: null, tenderTypeId: null, tenderAmountMinor: 0n, openingDate: null,
    approvingAuthorityId: null, contractorClassId: null, remarks: null, createdAt: new Date(), workNumber: "WRK/250",
  },
};

// GAP-WORKS-TENDERS-NEW-06: the TS gate is driven per test (default: sanctioned).
const tsByWork: Record<string, boolean> = {};
vi.mock("../src/modules/approval/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/approval/repo.js")>();
  return { ...orig, hasFinalizedTsForWork: vi.fn(async (_t: string, w: string) => tsByWork[w] ?? true) };
});

vi.mock("../src/modules/tender/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/tender/repo.js")>();
  return {
    ...orig,
    listTenders: vi.fn(async () => TENDER_PAGE),
    countTenders: vi.fn(async () => 250),
    getTenderById: vi.fn(async (_t: string, id: string) => tenderById[id] ?? null),
    getAwardById: vi.fn(async (_t: string, id: string) => awardStore[id] ?? null),
    listQuotations: vi.fn(async () => []),
    preTenderReferenceExists: vi.fn(async (_t: string, ref: string) => ref === "DUP/1"),
    tenderOrPreTenderExists: vi.fn(async () => true),
  };
});

vi.mock("../src/modules/execution/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/execution/repo.js")>();
  return { ...orig, listScopes: vi.fn(async () => []), listIssues: vi.fn(async () => []) };
});

vi.mock("@civitasone/db", () => ({
  createTenantDb: () => ({
    sqlClient: { end: vi.fn() },
    db: { transaction: vi.fn((fn: Function) => fn({})) },
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
  createQueue: () => ({ publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() }),
  MemoryQueue: class { publish = vi.fn().mockResolvedValue(undefined); subscribe = vi.fn(); start = vi.fn(); stop = vi.fn(); },
}));
vi.mock("@civitasone/observability", () => ({ registerOpsRoutes: vi.fn(), dbPing: vi.fn() }));
vi.mock("@civitasone/outbox", () => ({
  outboxMessages: {}, processed: {}, outboxSchema: {},
  enqueue: vi.fn(), markProcessed: vi.fn().mockResolvedValue(true), startRelay: vi.fn(() => setInterval(() => {}, 999999)),
}));
vi.mock("@civitasone/schemas/plugin", () => ({
  registerSchemaErrorHandler: (app: any, HttpError: any) => {
    app.setErrorHandler((err: any, _req: any, reply: any) => {
      if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
      if (err.name === "ZodError" || err.issues) return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: err.message } });
      return reply.status(500).send({ error: { code: "INTERNAL", message: "internal error" } });
    });
  },
}));
vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: Object.assign(async (app: any) => {
    app.decorateRequest("ctx", undefined);
    app.addHook("onRequest", async (req: any) => {
      const auth = req.headers?.authorization;
      if (!auth) return;
      try {
        const [, body] = auth.replace("Bearer ", "").split(".");
        const payload = JSON.parse(Buffer.from(body, "base64url").toString());
        (req as any).ctx = { tenantId: payload.tid, actorId: payload.sub, roles: payload.roles || [], correlationId: "c", sessionId: "s", actorType: "user" };
      } catch { /* leave ctx null */ }
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

const TENANT = "11111111-bbbb-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";
function authHeader(roles: string[]) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ sub: ACTOR, tid: TENANT, roles, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return { authorization: `Bearer ${header}.${body}.${Buffer.from("sig").toString("base64url")}` };
}

let app: FastifyInstance;
beforeAll(async () => { const { buildApp } = await import("../src/app.js"); app = await buildApp(); });
afterAll(async () => { await app.close(); });

// CLOS-S6-04: uuid path params must be validated (400) before reaching uuid columns (22P02 -> 500).
const BAD = "not-a-uuid";
const GOOD = "00000000-1111-4000-8000-000000000250";
const VIEW = authHeader(["works_viewer"]);

describe("CLOS-S6-04 uuid path param validation", () => {
  it.each([
    ["execution scopes", `/v1/works/execution/${BAD}/scopes`],
    ["execution issues", `/v1/works/execution/${BAD}/issues`],
    ["tender quotations", `/v1/works/tenders/${BAD}/quotations`],
  ])("%s: non-uuid id -> 400 and the repo is never queried", async (_n, url) => {
    const exec = await import("../src/modules/execution/repo.js");
    const tender = await import("../src/modules/tender/repo.js");
    vi.mocked(exec.listScopes).mockClear();
    vi.mocked(exec.listIssues).mockClear();
    vi.mocked(tender.listQuotations).mockClear();
    const res = await app.inject({ method: "GET", url, headers: VIEW });
    expect(res.statusCode).toBe(400);
    expect(exec.listScopes).not.toHaveBeenCalled();
    expect(exec.listIssues).not.toHaveBeenCalled();
    expect(tender.listQuotations).not.toHaveBeenCalled();
  });

  it.each([
    `/v1/works/execution/${GOOD}/scopes`,
    `/v1/works/execution/${GOOD}/issues`,
    `/v1/works/tenders/${GOOD}/quotations`,
  ])("valid uuid still returns 200: %s", async (url) => {
    const res = await app.inject({ method: "GET", url, headers: VIEW });
    expect(res.statusCode).toBe(200);
  });
});
