/**
 * SEC: report_viewer is read-only on scheduled reports; a report_user sees and
 * acts on only their own jobs / scheduled reports; admin roles keep tenant-wide
 * access; requestedBy is the actor (never the tenant id).
 * In-memory Fastify injection with mocked repos (no DB), like
 * roles-pagination-jobs.test.ts.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "99999999-9999-9999-9999-999999999999";
const JOB_ID = "22222222-2222-2222-2222-222222222222";
const SCHED_ID = "33333333-3333-3333-3333-333333333333";

const S = vi.hoisted(() => ({
  jobRows: [] as Record<string, unknown>[],
  schedRows: [] as Record<string, unknown>[],
  listJobsOwner: [] as unknown[],
  listSchedOwner: [] as unknown[],
  published: [] as { topic: string; msg: any }[],
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    listOrLoad: async <T>(_t: string, _r: string, _k: string, loader: () => Promise<T>) => loader(),
    put: async () => {},
    invalidate: async () => {},
    invalidateResource: async () => {},
    makeKey: (...a: string[]) => a.join(":"),
  },
  queue: { publish: async (topic: string, msg: unknown) => { S.published.push({ topic, msg: msg as any }); } },
}));

vi.mock("../src/modules/jobs/repo.js", () => ({
  findById: async (id: string) => S.jobRows.find((r) => r.id === id) ?? null,
  findDetailById: async (id: string) => S.jobRows.find((r) => r.id === id) ?? null,
  listByTenant: async (_t: string, _l: number, _o: number, owner?: string) => {
    S.listJobsOwner.push(owner);
    return S.jobRows.filter((r) => !owner || r.requestedBy === owner);
  },
  countByTenant: async () => 0,
  insert: async () => {},
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/scheduled/repo.js", () => ({
  findById: async (id: string) => S.schedRows.find((r) => r.id === id) ?? null,
  listByTenant: async (_t: string, _l: number, _o: number, owner?: string) => {
    S.listSchedOwner.push(owner);
    return S.schedRows.filter((r) => !owner || r.createdBy === owner);
  },
  countByTenant: async () => 0,
  insert: async () => {},
}));
vi.mock("../src/modules/kpis/repo.js", () => ({ listByTenant: async () => [] }));

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

const hdr = (roles: string[], sub = ME) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, JWT_SECRET, 3600)}` });

const apps: FastifyInstance[] = [];
afterAll(async () => { for (const a of apps) await a.close(); });

async function jobsApp() {
  const { jobRoutes } = await import("../src/modules/jobs/routes.js");
  const app = Fastify({ logger: false });
  const { authPlugin } = await import("@civitasone/auth/plugin");
  await app.register(authPlugin);
  await app.register(jobRoutes);
  await app.ready(); apps.push(app);
  return app;
}
async function schedApp() {
  const { scheduledRoutes } = await import("../src/modules/scheduled/routes.js");
  const app = Fastify({ logger: false });
  const { authPlugin } = await import("@civitasone/auth/plugin");
  await app.register(authPlugin);
  await app.register(scheduledRoutes);
  await app.ready(); apps.push(app);
  return app;
}

const job = (owner: string | null, id = JOB_ID) => ({
  id, tenantId: TENANT, name: "J", reportType: "x", status: "completed", format: "pdf", rowCount: 1,
  requestedBy: owner, completedAt: new Date(), createdAt: new Date(), downloadUrl: "https://files.example/x.pdf", version: 1,
});
const sched = (owner: string) => ({
  id: SCHED_ID, tenantId: TENANT, templateId: "44444444-4444-4444-4444-444444444444", cadence: "daily", recipients: ["a@b.com"],
  format: "pdf", enabled: true, lastRunAt: null, nextRunAt: new Date(), version: 1,
  createdAt: new Date(), updatedAt: new Date(), createdBy: owner, updatedBy: owner,
});

beforeEach(() => { S.jobRows = []; S.schedRows = []; S.listJobsOwner = []; S.listSchedOwner = []; S.published = []; });

describe("report_viewer cannot mutate scheduled reports", () => {
  it("403 on create / patch / delete / run, 200 on read", async () => {
    S.schedRows = [sched(ME)];
    const app = await schedApp();
    const h = hdr(["report_viewer"]);
    const create = await app.inject({ method: "POST", url: "/v1/reports/scheduled", headers: h,
      payload: { templateId: "44444444-4444-4444-4444-444444444444", cadence: "daily", recipients: ["x@y.com"], format: "pdf" } });
    expect(create.statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/v1/reports/scheduled/${SCHED_ID}`, headers: h, payload: { version: 1, enabled: false } })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: `/v1/reports/scheduled/${SCHED_ID}`, headers: h })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/reports/scheduled/${SCHED_ID}/run`, headers: h })).statusCode).toBe(403);
    expect(S.published).toHaveLength(0);
    expect((await app.inject({ method: "GET", url: "/v1/reports/scheduled", headers: h })).statusCode).toBe(200);
  });
});

describe("per-user job scoping", () => {
  it("report_user cannot get, download or share another user's job (404); admin can", async () => {
    S.jobRows = [job(OTHER)];
    const app = await jobsApp();
    const u = hdr(["report_user"]);
    expect((await app.inject({ method: "GET", url: `/v1/reports/jobs/${JOB_ID}`, headers: u })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/reports/report-jobs/${JOB_ID}`, headers: u })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/reports/jobs/${JOB_ID}/download`, headers: u })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/reports/jobs/${JOB_ID}/share`, headers: u, payload: { recipients: ["a@b.com"] } })).statusCode).toBe(404);
    expect(S.published).toHaveLength(0);

    const a = hdr(["report_admin"]);
    expect((await app.inject({ method: "GET", url: `/v1/reports/jobs/${JOB_ID}`, headers: a })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/reports/jobs/${JOB_ID}/download`, headers: a })).statusCode).toBe(302);
  });

  it("report_user can access their own job", async () => {
    S.jobRows = [job(ME)];
    const app = await jobsApp();
    const u = hdr(["report_user"]);
    expect((await app.inject({ method: "GET", url: `/v1/reports/jobs/${JOB_ID}`, headers: u })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/reports/jobs/${JOB_ID}/download`, headers: u })).statusCode).toBe(302);
  });

  it("legacy row with null requestedBy is admin-visible only and never shows the tenant id as requester", async () => {
    S.jobRows = [job(null)];
    const app = await jobsApp();
    expect((await app.inject({ method: "GET", url: `/v1/reports/jobs/${JOB_ID}`, headers: hdr(["report_user"]) })).statusCode).toBe(404);
    const res = await app.inject({ method: "GET", url: `/v1/reports/report-jobs/${JOB_ID}`, headers: hdr(["tenant_admin"]) });
    expect(res.statusCode).toBe(200);
    expect(res.json().requestedBy).not.toBe(TENANT);
  });

  it("list passes the owner filter for a report_user and none for an admin", async () => {
    S.jobRows = [job(ME, "a1"), job(OTHER, "b2")];
    const app = await jobsApp();
    const own = await app.inject({ method: "GET", url: "/v1/reports", headers: hdr(["report_user"]) });
    expect(own.statusCode).toBe(200);
    expect(S.listJobsOwner.at(-1)).toBe(ME);
    expect(own.json().data.map((r: any) => r.id)).toEqual(["a1"]);
    await app.inject({ method: "GET", url: "/v1/reports", headers: hdr(["admin"]) });
    expect(S.listJobsOwner.at(-1)).toBeUndefined();
  });
});

describe("per-user scheduled report scoping", () => {
  it("report_user cannot read, patch, delete or run another user's schedule; admin can read", async () => {
    S.schedRows = [sched(OTHER)];
    const app = await schedApp();
    const u = hdr(["report_user"]);
    expect((await app.inject({ method: "GET", url: `/v1/reports/scheduled/${SCHED_ID}`, headers: u })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/v1/reports/scheduled/${SCHED_ID}`, headers: u, payload: { version: 1, enabled: false } })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/v1/reports/scheduled/${SCHED_ID}`, headers: u })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/reports/scheduled/${SCHED_ID}/run`, headers: u })).statusCode).toBe(404);
    expect(S.published).toHaveLength(0);
    expect((await app.inject({ method: "GET", url: `/v1/reports/scheduled/${SCHED_ID}`, headers: hdr(["report_admin"]) })).statusCode).toBe(200);
  });

  it("list is owner-filtered for report_user and tenant-wide for admin; owner can run their own", async () => {
    S.schedRows = [sched(ME)];
    const app = await schedApp();
    await app.inject({ method: "GET", url: "/v1/reports/scheduled", headers: hdr(["report_user"]) });
    expect(S.listSchedOwner.at(-1)).toBe(ME);
    await app.inject({ method: "GET", url: "/v1/reports/scheduled", headers: hdr(["finance_admin"]) });
    expect(S.listSchedOwner.at(-1)).toBeUndefined();
    expect((await app.inject({ method: "POST", url: `/v1/reports/scheduled/${SCHED_ID}/run`, headers: hdr(["report_user"]) })).statusCode).toBe(202);
  });
});

describe("requestedBy is the actor at creation", () => {
  it("createJob projects requestedBy = actor id and publishes it", async () => {
    const app = await jobsApp();
    const res = await app.inject({ method: "POST", url: "/v1/reports/jobs", headers: hdr(["report_user"]), payload: { name: "R", reportType: "x" } });
    expect(res.statusCode).toBe(202);
    const msg = S.published.find((p) => p.topic.includes("job"))!.msg;
    expect(msg.actorId).toBe(ME);
    expect(msg.payload.requestedBy).toBe(ME);
    expect(msg.payload.requestedBy).not.toBe(TENANT);
  });
});
