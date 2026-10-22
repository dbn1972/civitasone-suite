/**
 * W2 works rescan, cluster 02 -- contractor register, detail, rating history and rating routes.
 *
 *  GAP-WORKS-CONTRACTORS-03 / -06   ?pageSize / ?page are honoured (not silently stripped), meta.total is the true
 *                                   register size, and no list row carries a clear PAN
 *  GAP-WORKS-CONTRACTORS-06         the detail read returns the clear PAN only to the PAN-reveal roles
 *  GAP-WORKS-CONTRACTORS-DETAIL-03  rating history carries a server-resolved ratedByName (null when unresolved)
 *  GAP-WORKS-CONTRACTORS-DETAIL-04  a configured cooling-off period turns a repeat rating into 409 RATING_COOLDOWN
 */
import { randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const CONTRACTOR_ID = "00000000-cccc-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";
const OTHER_OFFICER = "00000000-aaaa-4000-8000-000000000002";
const UNKNOWN_OFFICER = "00000000-aaaa-4000-8000-000000000003";
const TENANT = "11111111-bbbb-4000-8000-000000000001";
const FULL_PAN = "AAAPZ1234C";

const publishMock = vi.fn().mockResolvedValue(undefined);
const listContractors = vi.fn();
const countContractors = vi.fn();
const findContractorById = vi.fn();
const listRatingHistory = vi.fn();
const latestRatingByActor = vi.fn();
const getProposal = vi.fn();
vi.mock("../src/modules/proposal/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/proposal/repo.js")>();
  return { ...orig, getProposal };
});

vi.mock("@civitasone/db", () => ({
  createTenantDb: () => ({ sqlClient: { end: vi.fn() }, db: {}, dbFor: vi.fn(), sqlClientFor: vi.fn(), tierOf: vi.fn(), dbForRead: vi.fn() }),
  createTenantTxHook: () => async () => {},
  tenantStorage: { enterWith: vi.fn() },
  runWithTenant: vi.fn((_t: string, fn: Function) => fn()),
}));
vi.mock("@civitasone/cache", () => ({
  Cache: class { getOrLoad() { return Promise.resolve(null); } invalidate() { return Promise.resolve(); } },
}));
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: Function) => fn({}) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn(async () => []),
}));
vi.mock("@civitasone/queue", () => ({
  createQueue: () => ({ publish: publishMock, subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() }),
  MemoryQueue: class { publish = publishMock; subscribe = vi.fn(); start = vi.fn(); stop = vi.fn(); },
}));
vi.mock("@civitasone/observability", () => ({ registerOpsRoutes: vi.fn(), dbPing: vi.fn() }));
vi.mock("@civitasone/outbox", () => ({
  outboxMessages: {}, processed: {}, outboxSchema: {},
  enqueue: vi.fn().mockResolvedValue(undefined), markProcessed: vi.fn().mockResolvedValue(true),
  startRelay: vi.fn(() => setInterval(() => {}, 999999)),
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
    resolveServiceContext: (req: any) => { if (!req.ctx) throw new AuthContextError(401, "UNAUTHENTICATED", "missing token"); return req.ctx; },
    AuthContextError,
  };
});
vi.mock("@civitasone/auth", () => ({
  hasAnyRole: (ctx: any, roles: string[]) => roles.some((r: string) => ctx.roles?.includes(r)),
}));
vi.mock("../src/modules/contractor/repo.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/modules/contractor/repo.js")>();
  return { ...orig, listContractors, countContractors, findContractorById, listRatingHistory, latestRatingByActor };
});

function authHeader(roles: string[]) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ sub: ACTOR, tid: TENANT, roles, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return { authorization: `Bearer ${header}.${body}.${Buffer.from("sig").toString("base64url")}` };
}

let app: FastifyInstance;
beforeAll(async () => {
  // Generated per run, never committed (the PAN column is encrypted at rest and the suite needs a key).
  process.env.PII_ENC_KEY ??= randomBytes(32).toString("hex");
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => { await app.close(); });

const row = (over: Record<string, unknown> = {}) => ({
  id: CONTRACTOR_ID, name: "ABC Constructions", registrationNo: "REG-1", pan: FULL_PAN, phone: "9876543210",
  active: true, performanceRating: 4, ratingCount: 3, ...over,
});

beforeEach(() => {
  publishMock.mockClear();
  listContractors.mockReset().mockResolvedValue([row()]);
  countContractors.mockReset().mockResolvedValue(1);
  findContractorById.mockReset().mockResolvedValue(row());
  listRatingHistory.mockReset().mockResolvedValue([]);
  latestRatingByActor.mockReset().mockResolvedValue(null);
  getProposal.mockReset().mockImplementation(async (_t: string, id: string) => ({ id, status: "dao_finalized" }));
});

describe("GET /v1/works/contractors -- pagination contract (CONTRACTORS-03 / -06)", () => {
  const list = (qs: string, roles = ["works_viewer"]) =>
    app.inject({ method: "GET", url: `/v1/works/contractors${qs}`, headers: authHeader(roles) });

  it("?pageSize=100 is honoured: the query window is 100 rows, not the silent default of 50", async () => {
    const res = await list("?pageSize=100");
    expect(res.statusCode).toBe(200);
    expect(listContractors).toHaveBeenCalledWith(TENANT, { limit: 100, offset: 0 });
    expect(res.json().meta).toMatchObject({ limit: 100, offset: 0, page: 1, pageSize: 100 });
  });

  it("?page=3&pageSize=50 is rows 101-150 (offset 100)", async () => {
    await list("?page=3&pageSize=50");
    expect(listContractors).toHaveBeenCalledWith(TENANT, { limit: 50, offset: 100 });
  });

  it("?page=N with no pageSize pages by the default limit (it is not silently ignored): ?page=3 is rows 101-150", async () => {
    const res = await list("?page=3");
    expect(res.statusCode).toBe(200);
    expect(listContractors).toHaveBeenCalledWith(TENANT, { limit: 50, offset: 100 });
    expect(res.json().meta).toMatchObject({ limit: 50, offset: 100, page: 3, pageSize: 50 });
  });

  it("?page=N uses an explicit ?limit as its page length, and wins over a stray ?offset", async () => {
    const res = await list("?page=2&limit=20&offset=7");
    expect(listContractors).toHaveBeenCalledWith(TENANT, { limit: 20, offset: 20 });
    expect(res.json().meta).toMatchObject({ limit: 20, offset: 20, page: 2, pageSize: 20 });
  });

  it("?page=0 is a 400 with a field error naming page, never a silent page 1", async () => {
    const res = await list("?page=0");
    expect(res.statusCode).toBe(400);
    expect(res.json().fieldErrors.some((f: { field: string }) => f.field === "page")).toBe(true);
    expect(listContractors).not.toHaveBeenCalled();
  });

  it("the picker's ?pageSize=200 is honoured up to the 200 cap", async () => {
    await list("?pageSize=200");
    expect(listContractors).toHaveBeenCalledWith(TENANT, { limit: 200, offset: 0 });
  });

  it("limit/offset still work, and with no paging params the default window is 50 from 0", async () => {
    await list("?limit=20&offset=40");
    expect(listContractors).toHaveBeenLastCalledWith(TENANT, { limit: 20, offset: 40 });
    await list("");
    expect(listContractors).toHaveBeenLastCalledWith(TENANT, { limit: 50, offset: 0 });
  });

  it("meta.total is the true size of the register, not the length of the page", async () => {
    countContractors.mockResolvedValue(137);
    const res = await list("?pageSize=100");
    expect(res.json().meta.total).toBe(137);
    expect(countContractors).toHaveBeenCalledWith(TENANT);
  });

  it("a page size above the cap is a 400 with a field error naming pageSize", async () => {
    const res = await list("?pageSize=201");
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
    expect(res.json().fieldErrors.some((f: { field: string }) => f.field === "pageSize")).toBe(true);
    expect(listContractors).not.toHaveBeenCalled();
  });

  it("no list row carries a clear PAN -- not for a reader, and not even for a PAN-reveal role", async () => {
    for (const roles of [["works_viewer"], ["estimator"], ["works_admin"], ["dao"]]) {
      const res = await list("?pageSize=100", roles);
      expect(res.statusCode).toBe(200);
      expect(res.json().data[0].pan).toBe("AAAPZ****C");
      expect(JSON.stringify(res.json())).not.toContain(FULL_PAN);
    }
  });

  it("a row with no PAN stays null and a malformed stored PAN is masked in full", async () => {
    listContractors.mockResolvedValue([row({ pan: null }), row({ id: "x", pan: "SHORT" })]);
    const res = await list("");
    expect(res.json().data[0].pan).toBeNull();
    expect(res.json().data[1].pan).toBe("*****");
  });

  it("403 for a role with no works access, and nothing is read", async () => {
    const res = await list("?pageSize=100", ["citizen"]);
    expect(res.statusCode).toBe(403);
    expect(listContractors).not.toHaveBeenCalled();
    expect(countContractors).not.toHaveBeenCalled();
  });
});

describe("GET /v1/works/contractors/:id -- clear PAN only for the PAN-reveal roles", () => {
  const detail = (roles: string[]) =>
    app.inject({ method: "GET", url: `/v1/works/contractors/${CONTRACTOR_ID}`, headers: authHeader(roles) });

  it("works_admin / super_admin / dao / do receive the clear PAN (the edit form needs it)", async () => {
    for (const role of ["works_admin", "super_admin", "dao", "do"]) {
      expect((await detail([role])).json().data.pan).toBe(FULL_PAN);
    }
  });

  it("works_operator, works_viewer, estimator, sdo and section_officer receive the masked PAN only", async () => {
    for (const role of ["works_operator", "works_viewer", "estimator", "sdo", "section_officer"]) {
      const res = await detail([role]);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.pan).toBe("AAAPZ****C");
      expect(JSON.stringify(res.json())).not.toContain(FULL_PAN);
    }
  });
});

describe("GET /v1/works/contractors/:id/rating-history -- ratedByName (DETAIL-03)", () => {
  const SECRET = globalThis.crypto.randomUUID();
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let savedSecret: string | undefined;
  beforeEach(() => {
    savedSecret = process.env.INTERNAL_SERVICE_SECRET;
    process.env.INTERNAL_SERVICE_SECRET = SECRET;
    listRatingHistory.mockResolvedValue([
      { id: "r1", rating: 5, ratedBy: ACTOR, ratedAt: "2026-10-01T10:00:00.000Z", note: "on time" },
      { id: "r2", rating: 3, ratedBy: UNKNOWN_OFFICER, ratedAt: "2026-09-01T10:00:00.000Z", note: null },
    ]);
  });
  afterEach(() => {
    fetchSpy?.mockRestore();
    if (savedSecret === undefined) delete process.env.INTERNAL_SERVICE_SECRET; else process.env.INTERNAL_SERVICE_SECRET = savedSecret;
  });
  const history = () =>
    app.inject({ method: "GET", url: `/v1/works/contractors/${CONTRACTOR_ID}/rating-history`, headers: authHeader(["works_viewer"]) });

  it("resolves each rater's display name through identity-service, tenant-scoped, and returns only the asked-for names", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([
        { id: ACTOR, name: "Asha Verma" },
        { id: OTHER_OFFICER, name: "Someone Never Asked For" },
      ]), { status: 200 }),
    );
    const res = await history();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data[0]).toMatchObject({ id: "r1", ratedByName: "Asha Verma", note: "on time" });
    expect(body.data[1].ratedByName).toBeNull();
    expect(JSON.stringify(body)).not.toContain("Someone Never Asked For");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/identity/internal/user-summaries");
    expect(init.headers).toMatchObject({ "x-internal": "1", "x-tenant-id": TENANT, "x-service-secret": SECRET });
  });

  it("fails OPEN when identity-service is down: 200, every ratedByName null, no raw id leaks into a name", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connect ECONNREFUSED"));
    const res = await history();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((r: { ratedByName: unknown }) => r.ratedByName)).toEqual([null, null]);
  });

  it("an identity error status is also a graceful null, and an empty history makes no identity call at all", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 503 }));
    expect((await history()).json().data[0].ratedByName).toBeNull();
    fetchSpy.mockClear();
    listRatingHistory.mockResolvedValue([]);
    expect((await history()).json().data).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports the configured cooling-off period in meta so the form's warning matches the enforced rule", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("[]", { status: 200 }));
    expect((await history()).json().meta.cooldownDays).toBe(0);
    process.env.WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS = "45";
    try {
      expect((await history()).json().meta.cooldownDays).toBe(45);
    } finally {
      delete process.env.WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS;
    }
  });
});

describe("PATCH /v1/works/contractors/:id/rate -- cooling-off period (DETAIL-04)", () => {
  const rate = (payload: object = { rating: 4, comment: "solid delivery on time" }) =>
    app.inject({ method: "PATCH", url: `/v1/works/contractors/${CONTRACTOR_ID}/rate`, headers: authHeader(["works_admin"]), payload });
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  afterEach(() => { delete process.env.WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS; });

  it("with no cooldown configured nothing is blocked and the history is not even consulted", async () => {
    const res = await rate();
    expect(res.statusCode).toBe(202);
    expect(latestRatingByActor).not.toHaveBeenCalled();
  });

  it("a repeat rating by the same officer inside the configured window is 409 RATING_COOLDOWN and publishes nothing", async () => {
    process.env.WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS = "30";
    latestRatingByActor.mockResolvedValue({ ratedAt: daysAgo(10) });
    const res = await rate();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("RATING_COOLDOWN");
    expect(latestRatingByActor).toHaveBeenCalledWith(TENANT, CONTRACTOR_ID, ACTOR);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("once the window has passed, or the officer never rated it, the rating is accepted", async () => {
    process.env.WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS = "30";
    latestRatingByActor.mockResolvedValue({ ratedAt: daysAgo(31) });
    expect((await rate()).statusCode).toBe(202);
    latestRatingByActor.mockResolvedValue(null);
    expect((await rate()).statusCode).toBe(202);
    expect(publishMock).toHaveBeenCalledTimes(2);
  });

  it("an unusable setting (0, negative, text, fractional) means no cooldown rather than a guess", async () => {
    latestRatingByActor.mockResolvedValue({ ratedAt: daysAgo(1) });
    for (const bad of ["0", "-5", "abc", "2.5", ""]) {
      process.env.WORKS_CONTRACTOR_RATING_COOLDOWN_DAYS = bad;
      expect((await rate()).statusCode).toBe(202);
    }
    expect(latestRatingByActor).not.toHaveBeenCalled();
  });
});

describe("PATCH /v1/works/contractors/:id/rate -- optional link to a work (DETAIL-04)", () => {
  const WORK_ID = "00000000-1111-4000-8000-000000000001";
  const rate = (payload: object) =>
    app.inject({ method: "PATCH", url: `/v1/works/contractors/${CONTRACTOR_ID}/rate`, headers: authHeader(["works_admin"]), payload });

  it("a rating naming an existing work is accepted and the workId travels in the command", async () => {
    const res = await rate({ rating: 4, comment: "met the schedule", workId: WORK_ID });
    expect(res.statusCode).toBe(202);
    expect(getProposal).toHaveBeenCalledWith(TENANT, WORK_ID);
    const cmd = publishMock.mock.calls.find((c) => String(c[0]).includes("contractor.rate"));
    expect(cmd?.[1]?.payload).toMatchObject({ rating: 4, comment: "met the schedule", workId: WORK_ID });
  });

  it("a work that does not exist in the tenant is 404 and nothing is published", async () => {
    getProposal.mockResolvedValueOnce(null as never);
    const res = await rate({ rating: 4, workId: WORK_ID });
    expect(res.statusCode).toBe(404);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("a malformed workId is a 400 with a field error, and a rating with no workId still works unchanged", async () => {
    const bad = await rate({ rating: 4, workId: "not-a-uuid" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().fieldErrors.some((f: { field: string }) => f.field === "workId")).toBe(true);
    const plain = await rate({ rating: 4 });
    expect(plain.statusCode).toBe(202);
    expect(getProposal).not.toHaveBeenCalled();
    const cmd = publishMock.mock.calls.find((c) => String(c[0]).includes("contractor.rate"));
    expect(cmd?.[1]?.payload).not.toHaveProperty("workId");
  });
});

describe("validation errors carry per-field messages (CONTRACTORS-06)", () => {
  it("a malformed PAN on create is 400 VALIDATION_FAILED with a fieldErrors entry for pan", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/works/contractors", headers: authHeader(["works_admin"]), payload: { name: "ABC", pan: "ABCDE12345" } });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.fieldErrors).toEqual([{ field: "pan", message: "invalid PAN" }]);
  });
});
