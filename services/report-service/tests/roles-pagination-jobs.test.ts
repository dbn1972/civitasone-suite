/**
 * GAP2-REPORTS-PAGINATION-01 + GAP2-REPORTS-ROLES-01 + GAP2-REPORTS-JOBS-01
 *
 * - PAGINATION-01: GET /v1/reports and /v1/reports/scheduled used to return
 *   meta.total = current (capped) page length. With 25 rows and limit=10 the
 *   total must be 25, not 10.
 * - ROLES-01: a `report_user` token must get a CONSISTENT result across
 *   GET /v1/reports/jobs and GET/POST /v1/reports/scheduled (all 200). Before
 *   the fix jobs accepted report_user but scheduled 403'd it.
 * - JOBS-01: a queued job created yesterday must report yesterday as
 *   requestedAt (from createdAt), not the current request time.
 *
 * In-memory Fastify injection with mocked repos (no DB).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";

const mockState = vi.hoisted(() => ({
  jobRows: [] as Record<string, unknown>[],
  jobCount: 0,
  schedRows: [] as Record<string, unknown>[],
  schedCount: 0,
}));

// Pass-through cache so queries hit the mocked repos directly.
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    listOrLoad: async <T>(_t: string, _r: string, _k: string, loader: () => Promise<T>) => loader(),
    put: async () => {},
    invalidate: async () => {},
    makeKey: (...a: string[]) => a.join(":"),
  },
  queue: { publish: async () => {} },
}));

vi.mock("../src/modules/jobs/repo.js", () => ({
  findById: async () => mockState.jobRows[0] ?? null,
  listByTenant: async () => mockState.jobRows.slice(0, 10),
  countByTenant: async () => mockState.jobCount,
  insert: async () => {},
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/scheduled/repo.js", () => ({
  findById: async () => mockState.schedRows[0] ?? null,
  listByTenant: async () => mockState.schedRows.slice(0, 10),
  countByTenant: async () => mockState.schedCount,
  insert: async () => {},
}));

vi.mock("../src/modules/kpis/repo.js", () => ({ listByTenant: async () => [] }));

vi.mock("../src/modules/scheduled/commands.js", () => ({
  createScheduledReport: async () => ({ id: "s1", status: "accepted", correlationId: "c1" }),
  updateScheduledReport: async () => ({ id: "s1", status: "accepted", correlationId: "c1" }),
  disableScheduledReport: async () => ({ id: "s1", status: "accepted", correlationId: "c1" }),
  runScheduledReport: async () => ({ id: "j1", status: "queued", correlationId: "c1" }),
}));

vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: async (app: FastifyInstance) => {
    app.decorateRequest("user", null);
    app.addHook("onRequest", async (req) => {
      const h = req.headers.authorization;
      if (!h) return;
      const [, payload] = h.replace("Bearer ", "").split(".");
      try { (req as unknown as Record<string, unknown>).user = JSON.parse(Buffer.from(payload!, "base64url").toString()); } catch { /* noop */ }
    });
  },
}));

vi.mock("@civitasone/auth/context", () => {
  class AuthContextError extends Error { status: number; code: string; constructor(s: number, c: string, m: string) { super(m); this.status = s; this.code = c; } }
  return {
    resolveServiceContext: (req: { headers: { authorization?: string } }) => {
      if (!req.headers.authorization) throw new AuthContextError(401, "UNAUTHORIZED", "unauthorized");
      const [, payload] = req.headers.authorization.replace("Bearer ", "").split(".");
      const d = JSON.parse(Buffer.from(payload!, "base64url").toString());
      return { tenantId: d.tid, actorId: d.sub, roles: d.roles ?? [], sessionId: d.sid ?? "s", correlationId: "c1" };
    },
    AuthContextError,
  };
});

function token(roles: string[]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-1" }, JWT_SECRET, 3600);
}

async function buildJobsApp(): Promise<FastifyInstance> {
  const { jobRoutes } = await import("../src/modules/jobs/routes.js");
  const app = Fastify({ logger: false });
  const { authPlugin } = await import("@civitasone/auth/plugin");
  await app.register(authPlugin);
  await app.register(jobRoutes);
  await app.ready();
  return app;
}

async function buildScheduledApp(): Promise<FastifyInstance> {
  const { scheduledRoutes } = await import("../src/modules/scheduled/routes.js");
  const app = Fastify({ logger: false });
  const { authPlugin } = await import("@civitasone/auth/plugin");
  await app.register(authPlugin);
  await app.register(scheduledRoutes);
  await app.ready();
  return app;
}

const apps: FastifyInstance[] = [];
afterAll(async () => { for (const a of apps) await a.close(); });

beforeEach(() => {
  mockState.jobRows = [];
  mockState.jobCount = 0;
  mockState.schedRows = [];
  mockState.schedCount = 0;
});

describe("GAP2-REPORTS-PAGINATION-01: meta.total is the true count", () => {
  it("GET /v1/reports returns total=25 with 25 rows and limit=10", async () => {
    mockState.jobRows = Array.from({ length: 25 }, (_, i) => ({
      id: `job-${i}`, tenantId: TENANT, name: `J${i}`, reportType: null, status: "queued",
      format: "pdf", rowCount: null, requestedBy: ACTOR, completedAt: null,
      createdAt: new Date(), downloadUrl: null, version: 1,
    }));
    mockState.jobCount = 25;
    const app = await buildJobsApp(); apps.push(app);
    const res = await app.inject({ method: "GET", url: "/v1/reports?limit=10&offset=0", headers: { authorization: `Bearer ${token(["report_admin"])}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(10);
    expect(body.meta.total).toBe(25);
  });

  it("GET /v1/reports/scheduled returns total=25 with 25 rows and limit=10", async () => {
    mockState.schedRows = Array.from({ length: 25 }, (_, i) => ({
      id: `s-${i}`, tenantId: TENANT, templateId: "t", cadence: "daily", recipients: [],
      format: "pdf", enabled: true, lastRunAt: null, nextRunAt: null, version: 1,
      createdAt: new Date(), updatedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
    }));
    mockState.schedCount = 25;
    const app = await buildScheduledApp(); apps.push(app);
    const res = await app.inject({ method: "GET", url: "/v1/reports/scheduled?limit=10&offset=0", headers: { authorization: `Bearer ${token(["report_admin"])}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(10);
    expect(body.meta.total).toBe(25);
  });
});

describe("GAP2-REPORTS-ROLES-01: report_user is consistent across jobs and scheduled", () => {
  it("report_user gets 200 on GET /v1/reports/jobs AND GET/POST /v1/reports/scheduled", async () => {
    const jobsApp = await buildJobsApp(); apps.push(jobsApp);
    const schedApp = await buildScheduledApp(); apps.push(schedApp);
    const auth = { authorization: `Bearer ${token(["report_user"])}` };

    const jobs = await jobsApp.inject({ method: "GET", url: "/v1/reports/jobs", headers: auth });
    expect(jobs.statusCode).toBe(200);

    const schedList = await schedApp.inject({ method: "GET", url: "/v1/reports/scheduled", headers: auth });
    expect(schedList.statusCode).toBe(200);

    const schedCreate = await schedApp.inject({
      method: "POST", url: "/v1/reports/scheduled", headers: auth,
      payload: { templateId: "11111111-1111-4000-8000-000000000001", cadence: "daily", recipients: ["a@b.com"], format: "pdf" },
    });
    // report_user must NOT be 403'd here (the whole point of the gap). It is
    // either accepted (202) or a 400 on body shape — never a role 403.
    expect(schedCreate.statusCode).not.toBe(403);
  });
});

describe("GAP2-REPORTS-ROLES-01: report_viewer is read-only on jobs", () => {
  it("report_viewer gets 403 on POST /v1/reports/jobs and POST /jobs/:id/share but 200 on GET", async () => {
    const jobsApp = await buildJobsApp(); apps.push(jobsApp);
    const auth = { authorization: `Bearer ${token(["report_viewer"])}` };

    const list = await jobsApp.inject({ method: "GET", url: "/v1/reports/jobs", headers: auth });
    expect(list.statusCode).toBe(200);

    const create = await jobsApp.inject({
      method: "POST", url: "/v1/reports/jobs", headers: auth,
      payload: { templateId: "11111111-1111-4000-8000-000000000001", format: "pdf" },
    });
    expect(create.statusCode).toBe(403);

    const share = await jobsApp.inject({
      method: "POST", url: "/v1/reports/jobs/11111111-1111-4000-8000-000000000002/share", headers: auth,
      payload: { recipients: ["a@b.com"] },
    });
    expect(share.statusCode).toBe(403);
  });
});

describe("GAP2-REPORTS-JOBS-01: requestedAt is createdAt, not request time", () => {
  it("a queued job created yesterday reports yesterday as Requested", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    mockState.jobRows = [{
      id: JOB_ID, tenantId: TENANT, name: "Old job", reportType: null, status: "queued",
      format: "pdf", rowCount: null, requestedBy: ACTOR, completedAt: null,
      createdAt: yesterday, downloadUrl: null, version: 1,
    }];
    const app = await buildJobsApp(); apps.push(app);
    const res = await app.inject({ method: "GET", url: "/v1/reports/report-jobs", headers: { authorization: `Bearer ${token(["report_admin"])}` } });
    expect(res.statusCode).toBe(200);
    const row = res.json()[0];
    expect(row.requestedAt.slice(0, 10)).toBe(yesterday.toISOString().slice(0, 10));
    // and NOT today
    const today = new Date().toISOString().slice(0, 10);
    if (yesterday.toISOString().slice(0, 10) !== today) {
      expect(row.requestedAt.slice(0, 10)).not.toBe(today);
    }
  });
});
