/**
 * UAT owner decision #17 (GAP-REPORTS-LIST-04), HTTP + job-consumer side:
 *  - unmasked PII exports can only be requested by report_admin, with a reason;
 *  - the grant reaches the render command only from the authenticated requester;
 *  - download links are minted per download and expire in 15 minutes.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ME = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";

const S = vi.hoisted(() => ({
  jobRows: [] as Record<string, unknown>[],
  published: [] as { topic: string; msg: any }[],
  presigns: [] as Array<{ key: string; expiresIn?: number }>,
  enqueued: [] as Record<string, unknown>[],
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    listOrLoad: async <T>(_t: string, _r: string, _k: string, loader: () => Promise<T>) => loader(),
    put: async () => {}, invalidate: async () => {}, invalidateResource: async () => {},
    makeKey: (...a: string[]) => a.join(":"),
  },
  queue: { publish: async (topic: string, msg: unknown) => { S.published.push({ topic, msg: msg as any }); } },
}));
vi.mock("../src/modules/jobs/repo.js", () => ({
  findById: async (id: string) => S.jobRows.find((r) => r.id === id) ?? null,
  findDetailById: async (id: string) => S.jobRows.find((r) => r.id === id) ?? null,
  listByTenant: async () => S.jobRows, countByTenant: async () => 0,
  insert: async () => {}, toView: (r: Record<string, unknown>) => r,
}));
vi.mock("../src/modules/scheduled/repo.js", () => ({ findById: async () => null, listByTenant: async () => [], countByTenant: async () => 0, insert: async () => {} }));
vi.mock("../src/modules/kpis/repo.js", () => ({ listByTenant: async () => [] }));
vi.mock("@civitasone/storage", () => ({
  presignedGetUrl: async (o: { key: string; expiresIn?: number }) => { S.presigns.push(o); return `https://files.example/${o.key}?X-Amz-Expires=${o.expiresIn}`; },
  putObject: async () => {},
}));
vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: async (app: FastifyInstance) => {
    app.decorateRequest("user", null);
    app.addHook("onRequest", async (req) => {
      const h = req.headers.authorization; if (!h) return;
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
vi.mock("../src/shared/db.js", () => {
  const tx = { insert: () => ({ values: () => ({ returning: () => [{}] }) }) };
  return { db: { ...tx, transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) }, sqlClient: { end: async () => {} } };
});
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: async (_tx: unknown, ev: Record<string, unknown>) => { S.enqueued.push(ev); },
  markProcessed: async () => true,
}));
vi.mock("../src/shared/tenant-queue.js", () => ({ tenantScoped: (q: unknown) => q }));

const hdr = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ME, tid: TENANT, roles, sid: "s" }, JWT_SECRET, 3600)}` });
const apps: FastifyInstance[] = [];
afterAll(async () => { for (const a of apps) await a.close(); });
async function jobsApp() {
  const { jobRoutes } = await import("../src/modules/jobs/routes.js");
  const app = Fastify({ logger: false });
  const { authPlugin } = await import("@civitasone/auth/plugin");
  await app.register(authPlugin); await app.register(jobRoutes); await app.ready(); apps.push(app);
  return app;
}
const job = (over: Record<string, unknown> = {}) => ({
  id: JOB_ID, tenantId: TENANT, name: "J", reportType: "x", status: "completed", format: "pdf", rowCount: 1,
  requestedBy: ME, completedAt: new Date(), createdAt: new Date(),
  downloadUrl: "https://files.example/legacy?X-Amz-Expires=86400", version: 1,
  parameters: {}, resultColumns: [], resultRows: [], ...over,
});
const REASON = "DPO-approved audit request 42";
const create = (app: FastifyInstance, roles: string[], payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/v1/reports/jobs", headers: { ...hdr(roles), "content-type": "application/json" }, payload });
const createCmd = () => S.published.find((p) => p.topic === "reports.job.create");

beforeEach(() => { S.jobRows = []; S.published = []; S.presigns = []; S.enqueued = []; });

describe("owner decision #17 — who may request an unmasked export", () => {
  it("a plain job request carries no unmask grant", async () => {
    const res = await create(await jobsApp(), ["report_user"], { name: "Payroll" });
    expect(res.statusCode).toBe(202);
    expect(JSON.stringify(createCmd()!.msg.payload)).not.toContain("piiUnmask");
  });

  it("report_user asking for unmasked PII is refused (403) and nothing is queued", async () => {
    const res = await create(await jobsApp(), ["report_user"], { name: "Payroll", unmaskPii: true, unmaskReason: REASON });
    expect(res.statusCode).toBe(403);
    expect(createCmd()).toBeUndefined();
  });

  it("other admin roles (finance_admin, tenant_admin, super_admin) are not enough either", async () => {
    const app = await jobsApp();
    for (const role of ["finance_admin", "tenant_admin", "super_admin", "admin"]) {
      const res = await create(app, [role], { name: "Payroll", unmaskPii: true, unmaskReason: REASON });
      expect(res.statusCode, role).toBe(403);
    }
    expect(createCmd()).toBeUndefined();
  });

  it("report_admin without a reason gets a 400 field error", async () => {
    const res = await create(await jobsApp(), ["report_admin"], { name: "Payroll", unmaskPii: true });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("unmaskReason");
    expect(createCmd()).toBeUndefined();
  });

  it("report_admin with a reason is accepted and the grant rides the command", async () => {
    const res = await create(await jobsApp(), ["report_admin"], { name: "Payroll", unmaskPii: true, unmaskReason: REASON });
    expect(res.statusCode).toBe(202);
    expect(createCmd()!.msg.payload.piiUnmask).toEqual({ reason: REASON });
  });
});

describe("owner decision #17 — the job consumer issues the grant and audits the request", () => {
  async function deliver(payload: Record<string, unknown>) {
    const { registerJobConsumers } = await import("../src/modules/jobs/consumer.js");
    const handlers = new Map<string, (m: unknown) => Promise<void>>();
    registerJobConsumers({ subscribe: (t: string, h: (m: unknown) => Promise<void>) => { handlers.set(t, h); }, publish: async () => {} } as any);
    await handlers.get("reports.job.create")!({
      messageId: JOB_ID, type: "reports.job.create", tenantId: TENANT, actorId: ME, correlationId: "c", schemaVersion: "1.0",
      payload: { id: JOB_ID, tenantId: TENANT, name: "Payroll", reportType: null, status: "queued", format: "pdf", ...payload },
    });
  }

  it("forwards grantedBy = the authenticated actor and audits the unmask request with the reason", async () => {
    await deliver({ piiUnmask: { reason: REASON } });
    const render = S.enqueued.find((e) => e.topic === "reports.job.render")!;
    expect((render.payload as any).piiUnmask).toEqual({ reason: REASON, grantedBy: ME });
    const audit = S.enqueued.filter((e) => e.topic === "audit.event.record").map((e) => e.payload as any).find((p) => p.action === "pii_unmask_requested");
    expect(audit).toMatchObject({ resourceType: "job", resourceId: JOB_ID, outcome: "success", unmaskReason: REASON });
  });

  it("forwards nothing when no grant was requested", async () => {
    await deliver({});
    const render = S.enqueued.find((e) => e.topic === "reports.job.render")!;
    expect((render.payload as any).piiUnmask).toBeUndefined();
  });
});

describe("owner decision #17 — download links expire in 15 minutes", () => {
  it("mints a fresh 15-minute URL from the deterministic key, ignoring a stored legacy 24h URL", async () => {
    S.jobRows = [job()];
    const res = await (await jobsApp()).inject({ method: "GET", url: `/v1/reports/jobs/${JOB_ID}/download`, headers: hdr(["report_user"]) });
    expect(res.statusCode).toBe(302);
    expect(S.presigns).toEqual([{ key: `reports/${TENANT}/${JOB_ID}.pdf`, expiresIn: 900 }]);
    expect(res.headers.location).toContain("X-Amz-Expires=900");
    expect(res.headers.location).not.toContain("legacy");
  });

  it("share hands recipients a 15-minute link too", async () => {
    S.jobRows = [job()];
    const res = await (await jobsApp()).inject({
      method: "POST", url: `/v1/reports/jobs/${JOB_ID}/share`,
      headers: { ...hdr(["report_user"]), "content-type": "application/json" },
      payload: { recipients: ["a@example.com"] },
    });
    expect(res.statusCode).toBe(202);
    expect(S.presigns).toEqual([{ key: `reports/${TENANT}/${JOB_ID}.pdf`, expiresIn: 900 }]);
    const shared = S.published.find((p) => p.topic === "reports.job.share")!;
    expect(shared.msg.payload.downloadUrl).toContain("X-Amz-Expires=900");
  });
});
