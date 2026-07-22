/**
 * Report Service — All Routes Coverage Test
 *
 * Comprehensive route inject tests for all report-service modules.
 * Uses in-memory Fastify injection (no network, no real DB).
 *
 * Tests: jobRoutes, dashboardRoutes, scheduledRoutes, templateRoutes
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const JOB_ID = "22222222-2222-2222-2222-222222222222";
const TEMPLATE_ID = "33333333-3333-3333-3333-333333333333";
const SCHEDULED_ID = "44444444-4444-4444-4444-444444444444";

// ─── Shared mock state (hoisted for vi.mock references) ──────────
const mockState = vi.hoisted(() => ({
  queryResult: [] as Record<string, unknown>[],
  countResult: 0,
  insertResult: null as Record<string, unknown> | null,
  updateResult: null as Record<string, unknown> | null,
}));

// ─── DB Mock — simple fluent chain ───────────────────────────────
vi.mock("../src/shared/db.js", () => {
  function chain(data: unknown[]) {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => c;
    c.groupBy = () => [];
    c.limit = (n: number) => {
      const sliced = (data as unknown[]).slice(0, n);
      return Object.assign(sliced, { offset: () => sliced });
    };
    c.offset = () => data;
    return c;
  }
  function select(fields?: Record<string, unknown>) {
    if (fields && Object.keys(fields).some((k) => k === "count")) {
      return { from: () => ({ where: () => [{ count: mockState.countResult }] }) };
    }
    return chain(mockState.queryResult);
  }
  function insert() {
    return { values: () => ({ returning: () => [mockState.insertResult ?? { id: "new-id" }] }) };
  }
  function update() {
    return { set: () => ({ where: () => ({ returning: () => mockState.updateResult ? [mockState.updateResult] : [] }) }) };
  }
  const txProxy = { select, insert, update };
  return {
    db: {
      select,
      insert,
      update,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txProxy),
    },
    sqlClient: { end: async () => {} },
    dbFor: () => ({ select, insert, update, transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txProxy) }),
    sqlClientFor: () => ({ end: async () => {} }),
    tierOf: () => "standard",
    dbForRead: () => ({ select, insert, update }),
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    listOrLoad: async <T>(_tid: string, _res: string, _key: string, loader: () => Promise<T>) => loader(),
    put: async () => {},
    invalidate: async () => {},
    invalidateAfterCommit: async () => {},
    makeKey: (...args: string[]) => args.join(":"),
  },
  queue: { publish: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({ enqueue: async () => {}, markProcessed: async () => {} }));

vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: async (app: FastifyInstance) => {
    app.decorateRequest("user", null);
    app.addHook("onRequest", async (req) => {
      if ((req.routeOptions as any)?.config?.public === true) return;
      const authHeader = req.headers.authorization;
      if (!authHeader) return;
      const token = authHeader.replace("Bearer ", "");
      try {
        const [, payload] = token.split(".");
        const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString());
        (req as any).user = decoded;
      } catch { /* no-op */ }
    });
  },
}));

vi.mock("@civitasone/auth/context", () => {
  class AuthContextError extends Error { status: number; code: string; constructor(s: number, c: string, m: string) { super(m); this.status = s; this.code = c; } }
  return {
    resolveServiceContext: (req: { headers: { authorization?: string } }) => {
      if (!req.headers.authorization) throw new AuthContextError(401, "UNAUTHORIZED", "unauthorized");
      const token = req.headers.authorization.replace("Bearer ", "");
      const [, payload] = token.split(".");
      const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString());
      return { tenantId: decoded.tid, actorId: decoded.sub, roles: decoded.roles ?? [], sessionId: decoded.sid ?? "s", correlationId: "corr-1" };
    },
    AuthContextError,
  };
});

vi.mock("@civitasone/auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@civitasone/auth")>();
  return {
    ...orig,
    hasAnyRole: (ctx: { roles: string[] }, required: string[]) => required.some((r) => ctx.roles.includes(r)),
  };
});

vi.mock("@civitasone/db", () => ({
  createSqlClient: () => ({}),
  createTenantDb: () => ({
    sqlClient: { end: async () => {} },
    db: {},
    dbFor: () => ({}),
    sqlClientFor: () => ({ end: async () => {} }),
    tierOf: () => "standard",
    dbForRead: () => ({}),
  }),
  createTenantTxHook: () => async () => {},
  tenantStorage: { enterWith: () => {} },
  runWithTenant: async (_tid: string, fn: () => Promise<unknown>) => fn(),
  setTenantGuc: async () => {},
}));

vi.mock("@civitasone/observability", () => ({ registerOpsRoutes: () => {}, dbPing: async () => true }));
vi.mock("@civitasone/schemas/plugin", () => ({ registerSchemaErrorHandler: () => {} }));
vi.mock("@fastify/cors", () => ({ default: async () => {} }));

// ─── Repo mocks ─────────────────────────────────────────────────
vi.mock("../src/modules/jobs/repo.js", () => ({
  findById: async () => mockState.queryResult[0] ?? null,
  listByTenant: async () => mockState.queryResult,
  insert: async () => {},
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/dashboard/repo.js", () => ({
  listDashboards: async () => mockState.queryResult,
}));

vi.mock("../src/modules/scheduled/repo.js", () => ({
  findById: async () => mockState.queryResult[0] ?? null,
  listByTenant: async () => mockState.queryResult,
  insert: async () => {},
}));

vi.mock("../src/modules/templates/repo.js", () => ({
  findById: async () => mockState.queryResult[0] ?? null,
  listByTenant: async () => mockState.queryResult,
  countByTenant: async () => mockState.countResult,
  insert: async () => {},
  update: async () => true,
  softDelete: async () => true,
  toView: (r: Record<string, unknown>) => r,
}));

vi.mock("../src/modules/kpis/repo.js", () => ({
  listByTenant: async () => mockState.queryResult,
}));

// ─── Command mocks ──────────────────────────────────────────────
vi.mock("../src/modules/jobs/commands.js", () => ({
  createJob: async () => ({ id: JOB_ID, status: "accepted", correlationId: "corr-1" }),
}));

vi.mock("../src/modules/scheduled/commands.js", () => ({
  createScheduledReport: async () => ({ id: SCHEDULED_ID, status: "accepted", correlationId: "corr-1" }),
}));

vi.mock("../src/modules/templates/commands.js", () => ({
  createTemplate: async () => ({ id: TEMPLATE_ID, status: "accepted", correlationId: "corr-1" }),
  updateTemplate: async () => ({ id: TEMPLATE_ID, status: "accepted", correlationId: "corr-1" }),
  deleteTemplate: async () => ({ id: TEMPLATE_ID, status: "accepted", correlationId: "corr-1" }),
  executeTemplate: async () => ({ id: "job-id-1", status: "accepted", correlationId: "corr-1" }),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: {
    createJob: "reports.job.create",
    renderJob: "reports.job.render",
    createTemplate: "reports.template.create",
    updateTemplate: "reports.template.update",
    deleteTemplate: "reports.template.delete",
    executeTemplate: "reports.template.execute",
    scheduledGenerate: "reports.scheduled.generate",
  },
  EVENTS: {},
  SERVICE: "reports",
  RESOURCE: "job",
}));

// ─── Token helpers ────────────────────────────────────────────────
function makeToken(roles: string[] = ["super_admin"]): string {
  return signToken({ sub: ACTOR_ID, tid: TENANT_ID, roles, sid: "sess-1" }, JWT_SECRET, 3600);
}
const ADMIN_TOKEN = () => makeToken(["super_admin"]);
const REPORT_ADMIN_TOKEN = () => makeToken(["report_admin"]);
const TENANT_ADMIN_TOKEN = () => makeToken(["tenant_admin"]);
const NO_ROLE_TOKEN = () => makeToken(["employee"]);

// ─── Seed data templates ─────────────────────────────────────────
const SEED_JOB = {
  id: JOB_ID,
  tenantId: TENANT_ID,
  name: "Monthly Report",
  reportType: "finance",
  status: "completed",
  format: "pdf",
  rowCount: 100,
  requestedBy: ACTOR_ID,
  completedAt: new Date("2026-07-01"),
  downloadUrl: "https://s3.example.com/report.pdf",
  version: 1,
};

const SEED_TEMPLATE = {
  id: TEMPLATE_ID,
  tenantId: TENANT_ID,
  name: "Finance Template",
  description: "Monthly finance report",
  dataSourceId: "finance.bills",
  filters: [],
  groups: [],
  aggregations: [],
  parameters: [],
  outputFormat: "pdf",
  status: "active",
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  createdBy: ACTOR_ID,
  updatedBy: ACTOR_ID,
};

const SEED_SCHEDULED = {
  id: SCHEDULED_ID,
  tenantId: TENANT_ID,
  templateId: TEMPLATE_ID,
  cadence: "daily",
  recipients: ["admin@example.com"],
  format: "pdf",
  enabled: true,
  lastRunAt: null,
  nextRunAt: new Date("2026-07-02"),
  createdBy: ACTOR_ID,
  createdAt: new Date(),
  updatedAt: new Date(),
  updatedBy: ACTOR_ID,
  version: 1,
};

// ═══════════════════════════════════════════════════════════════════
// 1. Job Routes
// ═══════════════════════════════════════════════════════════════════
describe("Job Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { jobRoutes } = await import("../src/modules/jobs/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(jobRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_JOB];
    mockState.countResult = 1;
    mockState.insertResult = SEED_JOB;
  });

  describe("POST /v1/reports/jobs", () => {
    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/jobs",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { name: "Monthly Report", reportType: "finance" },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.id).toBeDefined();
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/reports/jobs", payload: { name: "Test" } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/jobs",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { name: "Test" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for missing name", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/jobs",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/reports/jobs", () => {
    it("returns 200 with list", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/jobs",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeDefined();
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/reports/jobs" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/jobs",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/reports/report-jobs", () => {
    it("returns 200 with list", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/report-jobs",
        headers: { authorization: `Bearer ${REPORT_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/reports/report-jobs" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/report-jobs",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/reports/report-jobs/:id", () => {
    it("returns 200 when found", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/reports/report-jobs/${JOB_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "GET",
        url: `/v1/reports/report-jobs/${JOB_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/report-jobs/not-a-uuid",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/reports/report-jobs/${JOB_ID}` });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/reports/report-jobs/${JOB_ID}`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/reports/jobs/:id/download", () => {
    it("returns 302 redirect when job is completed", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/reports/jobs/${JOB_ID}/download`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe("https://s3.example.com/report.pdf");
    });

    it("returns 404 when job not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "GET",
        url: `/v1/reports/jobs/${JOB_ID}/download`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 409 when job not completed", async () => {
      mockState.queryResult = [{ ...SEED_JOB, status: "queued", downloadUrl: null }];
      const res = await app.inject({
        method: "GET",
        url: `/v1/reports/jobs/${JOB_ID}/download`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(409);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/reports/jobs/${JOB_ID}/download` });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/jobs/bad-uuid/download",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/reports/kpis", () => {
    it("returns 200 with KPI list", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/kpis",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/reports/kpis" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/kpis",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/reports/mis", () => {
    it("returns 200 with MIS list", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/mis",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/reports/mis" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/mis",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Dashboard Routes
// ═══════════════════════════════════════════════════════════════════
describe("Dashboard Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { dashboardRoutes } = await import("../src/modules/dashboard/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(dashboardRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [];
    mockState.countResult = 0;
  });

  describe("GET /v1/reports/dashboards", () => {
    it("returns 200 with dashboard data", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/dashboards",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.kpis).toBeDefined();
      expect(body.summary).toBeDefined();
    });

    it("returns 200 for report_admin role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/dashboards",
        headers: { authorization: `Bearer ${REPORT_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/reports/dashboards" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/dashboards",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Scheduled Routes
// ═══════════════════════════════════════════════════════════════════
describe("Scheduled Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { scheduledRoutes } = await import("../src/modules/scheduled/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(scheduledRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_SCHEDULED];
    mockState.countResult = 1;
    mockState.insertResult = SEED_SCHEDULED;
    mockState.updateResult = SEED_SCHEDULED;
  });

  describe("POST /v1/reports/scheduled", () => {
    it("returns 201 for valid body", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/scheduled",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: {
          templateId: TEMPLATE_ID,
          cadence: "daily",
          recipients: ["admin@example.com"],
          format: "pdf",
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.data).toBeDefined();
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/scheduled",
        payload: { templateId: TEMPLATE_ID, cadence: "daily", recipients: ["a@b.com"] },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/scheduled",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { templateId: TEMPLATE_ID, cadence: "daily", recipients: ["a@b.com"] },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for missing templateId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/scheduled",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { cadence: "daily" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid cadence", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/scheduled",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { templateId: TEMPLATE_ID, cadence: "biweekly", recipients: ["a@b.com"] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/reports/scheduled", () => {
    it("returns 200 with list", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/scheduled",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeDefined();
    });

    it("returns 200 for tenant_admin role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/scheduled",
        headers: { authorization: `Bearer ${TENANT_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/reports/scheduled" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/scheduled",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/reports/scheduled/:id", () => {
    it("returns 200 when found", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/reports/scheduled/${SCHEDULED_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeDefined();
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "GET",
        url: `/v1/reports/scheduled/${SCHEDULED_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/scheduled/not-a-uuid",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/reports/scheduled/${SCHEDULED_ID}` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /v1/reports/scheduled/:id", () => {
    it("returns 200 for valid update", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/reports/scheduled/${SCHEDULED_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { cadence: "weekly", version: 1 },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      mockState.updateResult = null;
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/reports/scheduled/${SCHEDULED_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { cadence: "weekly", version: 1 },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for missing version", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/reports/scheduled/${SCHEDULED_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { cadence: "weekly" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/reports/scheduled/${SCHEDULED_ID}`,
        payload: { version: 1 },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/reports/scheduled/${SCHEDULED_ID}`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { version: 1 },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("DELETE /v1/reports/scheduled/:id", () => {
    it("returns 204 on delete", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/v1/reports/scheduled/${SCHEDULED_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(204);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      mockState.updateResult = null;
      const res = await app.inject({
        method: "DELETE",
        url: `/v1/reports/scheduled/${SCHEDULED_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "DELETE", url: `/v1/reports/scheduled/${SCHEDULED_ID}` });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/v1/reports/scheduled/${SCHEDULED_ID}`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/v1/reports/scheduled/bad-uuid",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /v1/reports/scheduled/:id/run", () => {
    it("returns 202 for manual trigger", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/reports/scheduled/${SCHEDULED_ID}/run`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.data.jobId).toBeDefined();
      expect(body.data.status).toBe("queued");
    });

    it("returns 404 when scheduled report not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "POST",
        url: `/v1/reports/scheduled/${SCHEDULED_ID}/run`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/reports/scheduled/${SCHEDULED_ID}/run` });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/reports/scheduled/${SCHEDULED_ID}/run`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/scheduled/bad-uuid/run",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Template Routes
// ═══════════════════════════════════════════════════════════════════
describe("Template Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { templateRoutes } = await import("../src/modules/templates/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(templateRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_TEMPLATE];
    mockState.countResult = 1;
    mockState.insertResult = SEED_TEMPLATE;
    mockState.updateResult = SEED_TEMPLATE;
  });

  describe("POST /v1/reports/templates", () => {
    it("returns 202 for valid body", async () => {
      mockState.countResult = 0;
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/templates",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: {
          name: "Finance Template",
          dataSourceId: "finance.bills",
          filters: [],
          groups: [],
          aggregations: [],
          parameters: [],
          outputFormat: "pdf",
        },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.data.id).toBeDefined();
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/templates",
        payload: { name: "Test", dataSourceId: "finance.bills" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/templates",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { name: "Test", dataSourceId: "finance.bills" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for missing name", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/templates",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { dataSourceId: "finance.bills" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for missing dataSourceId", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/templates",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { name: "Test" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/reports/templates", () => {
    it("returns 200 with list", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/templates",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeDefined();
    });

    it("returns 200 for tenant_admin role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/templates",
        headers: { authorization: `Bearer ${TENANT_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/reports/templates" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/templates",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/reports/templates/:id", () => {
    it("returns 200 when found", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/reports/templates/${TEMPLATE_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toBeDefined();
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "GET",
        url: `/v1/reports/templates/${TEMPLATE_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 when archived", async () => {
      mockState.queryResult = [{ ...SEED_TEMPLATE, status: "archived" }];
      const res = await app.inject({
        method: "GET",
        url: `/v1/reports/templates/${TEMPLATE_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v1/reports/templates/not-a-uuid",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/reports/templates/${TEMPLATE_ID}` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /v1/reports/templates/:id", () => {
    it("returns 202 for valid update", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/reports/templates/${TEMPLATE_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { name: "Updated Template", version: 1 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 for missing version", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/reports/templates/${TEMPLATE_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { name: "Updated" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/reports/templates/${TEMPLATE_ID}`,
        payload: { version: 1 },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: `/v1/reports/templates/${TEMPLATE_ID}`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { version: 1 },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/v1/reports/templates/bad-id",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { version: 1 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("DELETE /v1/reports/templates/:id", () => {
    it("returns 202 for soft delete", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/v1/reports/templates/${TEMPLATE_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({ method: "DELETE", url: `/v1/reports/templates/${TEMPLATE_ID}` });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/v1/reports/templates/${TEMPLATE_ID}`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/v1/reports/templates/bad-id",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /v1/reports/templates/:id/execute", () => {
    it("returns 202 for valid execute", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/reports/templates/${TEMPLATE_ID}/execute`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { parameters: {}, outputFormat: "pdf" },
      });
      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.data.id).toBeDefined();
    });

    it("returns 401 without token", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/reports/templates/${TEMPLATE_ID}/execute`,
        payload: { parameters: {} },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/v1/reports/templates/${TEMPLATE_ID}/execute`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { parameters: {} },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/reports/templates/bad-id/execute",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { parameters: {} },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
