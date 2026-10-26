/**
 * GAP-REPORTS-LIST-04: job list/detail never expose the 24h presigned bearer URL
 * (they point at the authorising download endpoint instead) and every download
 * fetch writes an audit event. Mocked repos, like report-access-scoping.test.ts.
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

const PRESIGNED = "https://files.example/x.pdf?X-Amz-Signature=abc&X-Amz-Expires=86400";
const DOWNLOAD_PATH = `/v1/reports/jobs/${JOB_ID}/download`;
const job = (owner: string | null, over: Record<string, unknown> = {}) => ({
  id: JOB_ID, tenantId: TENANT, name: "J", reportType: "x", status: "completed", format: "pdf", rowCount: 1,
  requestedBy: owner, completedAt: new Date(), createdAt: new Date(), downloadUrl: PRESIGNED, version: 1,
  parameters: {}, resultColumns: [], resultRows: [], ...over,
});

beforeEach(() => { S.jobRows = []; S.listJobsOwner = []; S.published = []; });

describe("GAP-REPORTS-LIST-04 presigned URL is not exposed in job payloads", () => {
  it("report-jobs list and detail return the authorising download path, never the bearer URL", async () => {
    S.jobRows = [job(ME)];
    const app = await jobsApp();
    const list = await app.inject({ method: "GET", url: "/v1/reports/report-jobs", headers: hdr(["report_user"]) });
    expect(list.statusCode).toBe(200);
    expect(list.json()[0].downloadUrl).toBe(DOWNLOAD_PATH);
    const detail = await app.inject({ method: "GET", url: `/v1/reports/report-jobs/${JOB_ID}`, headers: hdr(["report_user"]) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().downloadUrl).toBe(DOWNLOAD_PATH);
    for (const body of [list.body, detail.body]) {
      expect(body).not.toContain("files.example");
      expect(body).not.toContain("X-Amz-Signature");
    }
  });

  it("the other job views (/v1/reports, /v1/reports/jobs, /v1/reports/jobs/:id) also hide it", async () => {
    S.jobRows = [job(ME)];
    const app = await jobsApp();
    for (const url of ["/v1/reports", "/v1/reports/jobs", `/v1/reports/jobs/${JOB_ID}`]) {
      const res = await app.inject({ method: "GET", url, headers: hdr(["report_user"]) });
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toContain("X-Amz-Signature");
    }
  });

  it("a job without a file yet has no downloadUrl", async () => {
    S.jobRows = [job(ME, { status: "running", downloadUrl: null })];
    const app = await jobsApp();
    const list = await app.inject({ method: "GET", url: "/v1/reports/report-jobs", headers: hdr(["report_user"]) });
    expect(list.json()[0].downloadUrl).toBeUndefined();
  });
});

describe("GAP-REPORTS-LIST-04 download is audited", () => {
  it("302s to the presigned URL and publishes one audit.event.record for the owner", async () => {
    S.jobRows = [job(ME)];
    const app = await jobsApp();
    const res = await app.inject({ method: "GET", url: DOWNLOAD_PATH, headers: hdr(["report_user"]) });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(PRESIGNED);
    const audits = S.published.filter((p) => p.topic === "audit.event.record");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.msg).toMatchObject({ tenantId: TENANT, actorId: ME });
    expect(audits[0]!.msg.payload).toMatchObject({
      service: "report", action: "download", resourceType: "report_job", resourceId: JOB_ID, outcome: "success",
    });
    expect(JSON.stringify(audits[0]!.msg)).not.toContain("X-Amz-Signature");
  });

  it("an admin fetching someone else's job is audited under the admin", async () => {
    S.jobRows = [job(OTHER)];
    const app = await jobsApp();
    const res = await app.inject({ method: "GET", url: DOWNLOAD_PATH, headers: hdr(["report_admin"]) });
    expect(res.statusCode).toBe(302);
    const audits = S.published.filter((p) => p.topic === "audit.event.record");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.msg.actorId).toBe(ME);
  });

  it("does not audit a denied (404) or not-ready (409) fetch as a download", async () => {
    const app = await jobsApp();
    S.jobRows = [job(OTHER)];
    expect((await app.inject({ method: "GET", url: DOWNLOAD_PATH, headers: hdr(["report_user"]) })).statusCode).toBe(404);
    S.jobRows = [job(ME, { status: "running", downloadUrl: null })];
    expect((await app.inject({ method: "GET", url: DOWNLOAD_PATH, headers: hdr(["report_user"]) })).statusCode).toBe(409);
    expect(S.published.filter((p) => p.topic === "audit.event.record")).toHaveLength(0);
  });

  it("fails closed (no redirect) when the audit write fails", async () => {
    S.jobRows = [job(ME)];
    const infra = await import("../src/shared/infra.js");
    const spy = vi.spyOn(infra.queue, "publish").mockRejectedValueOnce(new Error("bus down"));
    const app = await jobsApp();
    const res = await app.inject({ method: "GET", url: DOWNLOAD_PATH, headers: hdr(["report_user"]) });
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(res.headers.location).toBeUndefined();
    expect(res.body).not.toContain("bus down");
  });
});
