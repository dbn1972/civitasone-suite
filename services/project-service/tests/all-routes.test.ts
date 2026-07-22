/**
 * Project Service — All Routes Coverage Test
 *
 * Comprehensive route inject tests for all project-service modules.
 * Uses in-memory Fastify injection (no network, no real DB).
 *
 * Tests: project, scheme, progress, utilisation, geo, dashboard, evidence,
 * boardIntake, worldClassProject, mockElimination, scheduling, baselines,
 * wbs, delayForecast
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ACTOR = "22222222-2222-2222-2222-222222222222";
const PROJECT_ID = "33333333-3333-3333-3333-333333333333";
const TASK_ID = "44444444-4444-4444-4444-444444444444";
const MILESTONE_ID = "55555555-5555-5555-5555-555555555555";
const SCHEME_ID = "66666666-6666-6666-6666-666666666666";
const COMPONENT_ID = "77777777-7777-7777-7777-777777777777";
const RELEASE_ID = "88888888-8888-8888-8888-888888888888";
const INTAKE_ID = "99999999-9999-9999-9999-999999999999";
const DEP_ID = "aabbccdd-1111-4000-8000-000000000001";
const BASELINE_ID = "aabbccdd-2222-4000-8000-000000000002";
const RISK_ID = "aabbccdd-3333-4000-8000-000000000003";
const BILL_ID = "aabbccdd-4444-4000-8000-000000000004";
const CONTRACTOR_ID = "aabbccdd-5555-4000-8000-000000000005";

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
    if (fields && Object.keys(fields).some((k) => k === "count" || k === "cnt")) {
      return { from: () => ({ where: () => [{ count: mockState.countResult, cnt: mockState.countResult }] }) };
    }
    return chain(mockState.queryResult);
  }
  function insert() {
    return { values: () => ({ returning: () => [mockState.insertResult ?? { id: "new-id" }] }) };
  }
  function update() {
    return { set: () => ({ where: () => ({ returning: () => [mockState.updateResult ?? { id: "updated" }] }) }) };
  }
  const execute = async () => mockState.queryResult;
  return {
    db: {
      select, insert, update, execute,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ select, insert, update, execute }),
    },
    sqlClient: {},
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    put: async () => {},
    invalidate: async () => {},
    invalidateAfterCommit: async () => {},
    makeKey: (...args: string[]) => args.join(":"),
  },
  queue: { publish: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: async () => {},
  markProcessed: async () => {},
}));

vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: async (app: FastifyInstance) => {
    app.decorateRequest("user", null);
    app.addHook("onRequest", async (req) => {
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
  createTenantTxHook: () => async () => {},
  tenantStorage: { enterWith: () => {} },
  runWithTenant: async (_tid: string, fn: () => Promise<unknown>) => fn(),
  tenantTransaction: async (_db: unknown, _tid: string, fn: (tx: unknown) => Promise<unknown>) => {
    // Pass the same _db argument as "tx" to the callback
    return fn(_db);
  },
}));

vi.mock("@civitasone/observability", () => ({ registerOpsRoutes: () => {}, dbPing: async () => true }));
vi.mock("@civitasone/schemas/plugin", () => ({ registerSchemaErrorHandler: () => {} }));
vi.mock("@fastify/cors", () => ({ default: async () => {} }));

vi.mock("@civitasone/schemas/validate", () => ({
  sendAccepted: (reply: any, _schema: unknown, data: unknown) => { void reply.code(202).send(data); },
  sendValidated: (reply: any, _schema: unknown, data: unknown, status = 200) => { void reply.code(status).send(data); },
  parseRequest: (_schema: unknown, data: unknown) => data,
}));
vi.mock("@civitasone/schemas/common", () => ({
  acceptedResponseSchema: { parse: (d: unknown) => d },
  listQuerySchema: { parse: (d: unknown) => ({ limit: 20, page: 1, ...(d as object) }) },
}));
vi.mock("@civitasone/schemas/web", () => ({
  ProjectSummaryListSchema: { parse: (d: unknown) => d },
  ProjectDetailSchema: { parse: (d: unknown) => d },
  MilestoneSummaryListSchema: { parse: (d: unknown) => d },
  FundReleaseSummaryListSchema: { parse: (d: unknown) => d },
  SchemeSummaryListSchema: { parse: (d: unknown) => d },
  ProjectsDashboardSchema: { parse: (d: unknown) => d },
}));

// ─── Module repo/command mocks ────────────────────────────────────
vi.mock("../src/modules/project/commands.js", () => ({
  createProject: async () => ({ id: PROJECT_ID, accepted: true }),
  createTask: async () => ({ id: TASK_ID, accepted: true }),
  updateTaskStatus: async () => ({ accepted: true }),
  createMilestone: async () => ({ id: MILESTONE_ID, accepted: true }),
  completeMilestone: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/project/queries.js", () => ({
  listProjects: async () => ({ data: mockState.queryResult, meta: { page: 1, pageSize: 20, total: mockState.countResult } }),
  listProjectSummaries: async () => ({ data: mockState.queryResult, meta: { total: mockState.countResult } }),
  listMilestoneSummaries: async () => ({ data: mockState.queryResult, meta: { total: mockState.countResult } }),
  getProject: async (id: string) => mockState.queryResult[0] ?? null,
  getProjectDetail: async (id: string) => mockState.queryResult[0] ?? null,
}));

vi.mock("../src/modules/project/repo.js", () => ({
  findProjectByIdTx: async () => mockState.queryResult[0] ?? null,
  findMilestoneById: async () => mockState.queryResult[0] ?? null,
}));

vi.mock("../src/modules/scheme/commands.js", () => ({
  createScheme: async () => ({ id: SCHEME_ID, accepted: true }),
  createComponent: async () => ({ id: COMPONENT_ID, accepted: true }),
  createFundRelease: async () => ({ id: RELEASE_ID, accepted: true }),
  disburseFundRelease: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/scheme/queries.js", () => ({
  getScheme: async (id: string) => mockState.queryResult[0] ?? null,
  listSchemeSummaries: async () => ({ data: mockState.queryResult, meta: { total: mockState.countResult } }),
  listFundReleaseSummaries: async () => ({ data: mockState.queryResult, meta: { total: mockState.countResult } }),
}));

vi.mock("../src/modules/progress/commands.js", () => ({
  recordPhysicalProgress: async () => ({ accepted: true }),
  recordFinancialProgress: async () => ({ accepted: true }),
  submitDpr: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/progress/queries.js", () => ({
  getProgress: async () => ({ data: mockState.queryResult }),
}));

vi.mock("../src/modules/utilisation/commands.js", () => ({
  submitUc: async () => ({ accepted: true }),
}));

vi.mock("../src/modules/utilisation/queries.js", () => ({
  getUcStatements: async () => ({ data: mockState.queryResult }),
}));

vi.mock("../src/modules/geo/commands.js", () => ({
  geoTag: async () => ({ accepted: true }),
  requestPhotoUpload: async () => ({ uploadUrl: "https://s3.example.com/upload", key: "photos/test.jpg" }),
}));

vi.mock("../src/modules/geo/queries.js", () => ({
  getGeoTags: async () => ({ data: mockState.queryResult }),
}));

vi.mock("../src/modules/dashboard/queries.js", () => ({
  getDashboard: async () => ({ totalProjects: 5, active: 3, delayed: 1, completed: 1 }),
}));

vi.mock("../src/modules/evidence/repo.js", () => ({
  insert: async (input: Record<string, unknown>) => ({
    id: "ev-new-id", tenantId: input.tenantId, milestoneId: input.milestoneId,
    fileKey: input.fileKey, fileName: input.fileName, uploadedBy: input.uploadedBy,
    uploadedAt: new Date(),
  }),
  listByMilestone: async () => mockState.queryResult.map((r) => ({
    ...r, uploadedAt: new Date(), fileKey: r.fileKey ?? "file.pdf", fileName: r.fileName ?? "file.pdf",
  })),
}));

vi.mock("../src/modules/board-intake/repo.js", () => ({
  listByStatus: async () => mockState.queryResult,
  findById: async () => mockState.queryResult[0] ?? null,
  review: async () => {},
}));

vi.mock("../src/modules/scheduling/repo.js", () => ({
  countDepsForTask: async () => mockState.countResult,
  getProjectDeps: async () => [],
  insertDependency: async (_db: unknown, input: Record<string, unknown>) => ({
    ...input,
    lagMs: String(input.lagMs ?? "0"),
    createdAt: new Date().toISOString(),
  }),
  listDependencies: async () => ({ data: mockState.queryResult, meta: { page: 1, pageSize: 50, total: mockState.countResult } }),
  deleteDependency: async () => mockState.queryResult.length > 0,
}));

vi.mock("../src/modules/scheduling/evm.js", () => ({
  computeEvm: (pv: bigint, ev: bigint, ac: bigint) => ({
    pv, ev, ac,
    spi: pv > 0n ? Number(ev) / Number(pv) : null,
    cpi: ac > 0n ? Number(ev) / Number(ac) : null,
  }),
}));

vi.mock("../src/modules/delay-forecast/adapter.js", () => ({
  predictDelay: async () => null,
}));

vi.mock("@civitasone/circuit-breaker", () => ({
  CircuitBreakerOpenError: class extends Error { constructor() { super("circuit open"); } },
  createBreaker: () => ({ call: async (fn: () => Promise<unknown>) => fn() }),
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: {},
  EVENTS: {},
  CONSUMED_EVENTS: {},
}));

// ─── Token helpers ────────────────────────────────────────────────
function makeToken(roles: string[] = ["super_admin"], actorId = ACTOR_ID): string {
  return signToken({ sub: actorId, tid: TENANT_ID, roles, sid: "sess-1" }, JWT_SECRET, 3600);
}
const ADMIN_TOKEN = () => makeToken(["super_admin"]);
const PROJECT_MGR_TOKEN = () => makeToken(["project_manager"]);
const FINANCE_TOKEN = () => makeToken(["finance_officer"]);
const NO_ROLE_TOKEN = () => makeToken(["employee"]);

// ─── Seed data templates ─────────────────────────────────────────
const SEED_PROJECT = {
  id: PROJECT_ID, tenantId: TENANT_ID, code: "PROJ-001", name: "Highway Project",
  status: "active", schemeId: SCHEME_ID, startDate: "2026-01-01", endDate: "2027-12-31",
  dprCostMinor: 5000000, sanctionedMinor: 4500000, createdAt: new Date(), updatedAt: new Date(),
};

const SEED_SCHEME = {
  id: SCHEME_ID, tenantId: TENANT_ID, code: "SCH-001", name: "National Highway Scheme",
  type: "css", fundingPattern: "60:40", totalOutlayMinor: 100000000,
  createdAt: new Date(), updatedAt: new Date(),
};

const SEED_INTAKE = {
  id: INTAKE_ID, tenantId: TENANT_ID, status: "pending_review",
  decisionText: "Construct new bridge", meetingId: "meet-1", version: 1,
  createdAt: new Date(), updatedAt: new Date(),
};

const SEED_MILESTONE = {
  id: MILESTONE_ID, tenantId: TENANT_ID, projectId: PROJECT_ID,
  name: "Foundation Complete", plannedDate: "2026-06-01", status: "pending",
};

// ═══════════════════════════════════════════════════════════════════
// 1. Project Routes
// ═══════════════════════════════════════════════════════════════════
describe("Project Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { projectRoutes } = await import("../src/modules/project/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(projectRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_PROJECT];
    mockState.countResult = 1;
    mockState.insertResult = SEED_PROJECT;
  });

  describe("POST /v1/projects", () => {
    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/projects",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { code: "P-001", name: "New Project" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/projects", payload: { code: "X", name: "Y" } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/projects",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { code: "P-001", name: "New" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for missing name", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/projects",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { code: "P-001" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/projects", () => {
    it("returns project list for authorized user", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects", headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/projects/:id", () => {
    it("returns project when found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/not-uuid", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /v1/projects/:id/tasks", () => {
    it("returns 202 for valid task", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/tasks`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { name: "Foundation work" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/projects/${PROJECT_ID}/tasks`, payload: { name: "X" } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/tasks`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { name: "X" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for missing name", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/tasks`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("PATCH /v1/projects/:id/tasks/:taskId/status", () => {
    it("returns 202 for valid status update", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/projects/${PROJECT_ID}/tasks/${TASK_ID}/status`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { status: "in_progress" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 for invalid status", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/projects/${PROJECT_ID}/tasks/${TASK_ID}/status`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { status: "invalid_status" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid taskId UUID", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/projects/${PROJECT_ID}/tasks/bad-id/status`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { status: "completed" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /v1/projects/:id/milestones", () => {
    it("returns 202 for valid milestone", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/milestones`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { name: "Phase 1 Complete", plannedDate: "2026-06-01" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 for missing plannedDate", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/milestones`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { name: "X" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("PATCH /v1/projects/:id/milestones/:mId/complete", () => {
    it("returns 202 for valid complete", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/projects/${PROJECT_ID}/milestones/${MILESTONE_ID}/complete`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 for invalid mId", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/projects/${PROJECT_ID}/milestones/bad-id/complete`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. Scheme Routes
// ═══════════════════════════════════════════════════════════════════
describe("Scheme Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { schemeRoutes } = await import("../src/modules/scheme/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(schemeRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_SCHEME];
    mockState.countResult = 1;
    mockState.insertResult = SEED_SCHEME;
  });

  describe("POST /v1/projects/schemes", () => {
    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/projects/schemes",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { code: "SCH-001", name: "National Highway" },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "POST", url: "/v1/projects/schemes", payload: { code: "X", name: "Y" } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/projects/schemes",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { code: "SCH-001", name: "Test" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for missing code", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/projects/schemes",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { name: "Test" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/projects/schemes/:id", () => {
    it("returns scheme when found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/schemes/${SCHEME_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({ method: "GET", url: `/v1/projects/schemes/${SCHEME_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid UUID", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/schemes/bad", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/projects/schemes", () => {
    it("returns scheme list", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/schemes", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 403 for employee", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/schemes", headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/projects/fund-releases", () => {
    it("returns fund release list", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/fund-releases", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("POST /v1/projects/schemes/:id/components", () => {
    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/schemes/${SCHEME_ID}/components`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { code: "COMP-1", name: "Road Works", allocationMinor: 5000000 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 for missing allocationMinor", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/schemes/${SCHEME_ID}/components`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { code: "COMP-1", name: "Road Works" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /v1/projects/schemes/:id/fund-releases", () => {
    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/schemes/${SCHEME_ID}/fund-releases`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { releaseNo: "FR-001", componentId: COMPONENT_ID, amountMinor: 1000000 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 for missing releaseNo", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/schemes/${SCHEME_ID}/fund-releases`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { componentId: COMPONENT_ID, amountMinor: 1000000 },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. Progress Routes
// ═══════════════════════════════════════════════════════════════════
describe("Progress Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { progressRoutes } = await import("../src/modules/progress/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(progressRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [{ id: "prog-1", physicalPct: 45 }];
  });

  describe("POST /v1/projects/:id/physical-progress", () => {
    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/physical-progress`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { periodDate: "2026-06-01", physicalPct: 45 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/projects/${PROJECT_ID}/physical-progress`, payload: { periodDate: "2026-06-01", physicalPct: 45 } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/physical-progress`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { periodDate: "2026-06-01", physicalPct: 45 },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for physicalPct > 100", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/physical-progress`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { periodDate: "2026-06-01", physicalPct: 150 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /v1/projects/:id/financial-progress", () => {
    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/financial-progress`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { periodDate: "2026-06-01", expenditureMinor: 250000 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 400 for negative expenditure", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/financial-progress`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { periodDate: "2026-06-01", expenditureMinor: -100 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/projects/:id/progress", () => {
    it("returns progress data", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/progress`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/progress`, headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` } });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for invalid project id", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/bad-id/progress", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Geo Routes
// ═══════════════════════════════════════════════════════════════════
describe("Geo Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { geoRoutes } = await import("../src/modules/geo/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(geoRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  describe("POST /v1/projects/:id/geo-tags", () => {
    it("returns 202 for valid geo tag", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/geo-tags`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { lat: 28.6139, lon: 77.209 },
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/projects/${PROJECT_ID}/geo-tags`, payload: { lat: 28.6, lon: 77.2 } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 for lat out of range", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/geo-tags`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { lat: 100, lon: 77.209 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /v1/projects/:id/site-photos", () => {
    it("returns upload URL for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/site-photos`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { originalName: "photo1.jpg" },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 400 for missing originalName", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/site-photos`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/projects/:id/geo-tags", () => {
    it("returns geo tags list", async () => {
      mockState.queryResult = [{ lat: 28.6, lon: 77.2 }];
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/geo-tags`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 403 for employee", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/geo-tags`, headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` } });
      expect(res.statusCode).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. Dashboard Routes
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

  describe("GET /v1/projects/dashboard", () => {
    it("returns dashboard data for authorized user", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/dashboard", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/dashboard" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/dashboard", headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` } });
      expect(res.statusCode).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. Evidence Routes
// ═══════════════════════════════════════════════════════════════════
describe("Evidence Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { evidenceRoutes } = await import("../src/modules/evidence/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(evidenceRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_MILESTONE];
    mockState.countResult = 1;
  });

  describe("POST /v1/projects/milestones/:id/evidence", () => {
    it("returns 201 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/milestones/${MILESTONE_ID}/evidence`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { fileName: "report.pdf", fileUrl: "https://s3.example.com/report.pdf", fileType: "pdf" },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/projects/milestones/${MILESTONE_ID}/evidence`, payload: { fileName: "x", fileUrl: "https://x.com/x", fileType: "pdf" } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/milestones/${MILESTONE_ID}/evidence`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { fileName: "x", fileUrl: "https://x.com/x", fileType: "pdf" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 404 when milestone not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "POST", url: `/v1/projects/milestones/${MILESTONE_ID}/evidence`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { fileName: "x.pdf", fileUrl: "https://s3.example.com/x.pdf", fileType: "pdf" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid UUID param", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/projects/milestones/bad-id/evidence",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { fileName: "x", fileUrl: "https://x.com/x", fileType: "pdf" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/projects/milestones/:id/evidence", () => {
    it("returns evidence list", async () => {
      mockState.queryResult = [{ id: "ev-1", fileKey: "file.pdf", fileName: "file.pdf", uploadedBy: ACTOR_ID }];
      const res = await app.inject({ method: "GET", url: `/v1/projects/milestones/${MILESTONE_ID}/evidence`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeDefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Board Intake Routes
// ═══════════════════════════════════════════════════════════════════
describe("Board Intake Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { boardIntakeRoutes } = await import("../src/modules/board-intake/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(boardIntakeRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_INTAKE];
    mockState.countResult = 1;
  });

  describe("GET /v1/project/board-intake", () => {
    it("returns intake list", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/project/board-intake", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/project/board-intake" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/project/board-intake", headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/project/board-intake/:id", () => {
    it("returns intake item when found", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/project/board-intake/${INTAKE_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({ method: "GET", url: `/v1/project/board-intake/${INTAKE_ID}`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /v1/project/board-intake/:id/accept", () => {
    it("returns 200 for valid accept", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/project/board-intake/${INTAKE_ID}/accept`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { note: "Accepted for action" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("accepted");
    });

    it("returns 404 when item not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "POST", url: `/v1/project/board-intake/${INTAKE_ID}/accept`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: {},
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 409 when not pending_review", async () => {
      mockState.queryResult = [{ ...SEED_INTAKE, status: "accepted" }];
      const res = await app.inject({
        method: "POST", url: `/v1/project/board-intake/${INTAKE_ID}/accept`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: {},
      });
      expect(res.statusCode).toBe(409);
    });

    it("returns 403 for employee", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/project/board-intake/${INTAKE_ID}/accept`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/project/board-intake/:id/reject", () => {
    it("returns 200 for valid reject with note", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/project/board-intake/${INTAKE_ID}/reject`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { note: "Not relevant to this department" },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("rejected");
    });

    it("returns 400 for missing note (required for reject)", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/project/board-intake/${INTAKE_ID}/reject`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 409 when not pending_review", async () => {
      mockState.queryResult = [{ ...SEED_INTAKE, status: "rejected" }];
      const res = await app.inject({
        method: "POST", url: `/v1/project/board-intake/${INTAKE_ID}/reject`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { note: "Already done" },
      });
      expect(res.statusCode).toBe(409);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. World-Class Project Routes (Risks, EVM, RA Bills)
// ═══════════════════════════════════════════════════════════════════
describe("World-Class Project Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { worldClassProjectRoutes } = await import("../src/modules/project/world-class-routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(worldClassProjectRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_PROJECT];
    mockState.countResult = 1;
  });

  describe("GET /v1/projects/:id/risks", () => {
    it("returns risks list", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/risks`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/risks` });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/risks`, headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/projects/:id/risks", () => {
    it("returns 201 for valid risk", async () => {
      mockState.queryResult = [{ id: RISK_ID }];
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/risks`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { title: "Flooding risk", probability: "high", impact: "medium" },
      });
      expect(res.statusCode).toBe(201);
    });

    it("returns 400 for missing title", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/risks`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { probability: "high" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 404 when project not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/risks`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { title: "Test risk" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /v1/projects/:id/evm", () => {
    it("returns evm data when baseline exists", async () => {
      mockState.queryResult = [{ id: BASELINE_ID, label: "BL-1" }];
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/evm`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 422 when no baseline exists", async () => {
      mockState.queryResult = [];
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/evm`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(422);
    });

    it("returns 403 for employee", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/evm`, headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/projects/:id/evm/compute", () => {
    it("returns 201 for valid evm compute", async () => {
      mockState.queryResult = [SEED_PROJECT];
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/evm/compute`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { period: "2026-Q1", plannedValueMinor: 1000000, earnedValueMinor: 900000, actualCostMinor: 950000 },
      });
      expect(res.statusCode).toBe(201);
    });

    it("returns 400 for missing period", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/evm/compute`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { plannedValueMinor: 1000000 },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/projects/:id/ra-bills", () => {
    it("returns ra bills list", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/ra-bills`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/ra-bills` });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("POST /v1/projects/:id/ra-bills", () => {
    it("returns 201 for valid ra bill", async () => {
      mockState.queryResult = [{ id: BILL_ID }];
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/ra-bills`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: {
          contractorId: CONTRACTOR_ID, billNo: "RA-001", billDate: "2026-06-15",
          grossAmountMinor: 500000, deductionsMinor: 50000, netAmountMinor: 450000, cumulativeMinor: 450000,
        },
      });
      expect(res.statusCode).toBe(201);
    });

    it("returns 400 for missing billNo", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/ra-bills`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { contractorId: CONTRACTOR_ID, grossAmountMinor: 500000 },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. Scheduling Routes (Dependencies)
// ═══════════════════════════════════════════════════════════════════
describe("Scheduling Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { schedulingRoutes } = await import("../src/modules/scheduling/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(schedulingRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [{ id: DEP_ID, fromTaskId: TASK_ID, toTaskId: MILESTONE_ID }];
    mockState.countResult = 0;
  });

  describe("POST /v1/projects/:projectId/dependencies", () => {
    it("returns 201 for valid dependency", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/dependencies`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { fromTaskId: TASK_ID, toTaskId: MILESTONE_ID, depType: "FS", lagMs: 0 },
      });
      expect(res.statusCode).toBe(201);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/projects/${PROJECT_ID}/dependencies`, payload: { fromTaskId: TASK_ID, toTaskId: MILESTONE_ID } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/dependencies`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { fromTaskId: TASK_ID, toTaskId: MILESTONE_ID },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 422 for self-dependency", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/dependencies`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { fromTaskId: TASK_ID, toTaskId: TASK_ID },
      });
      expect(res.statusCode).toBe(422);
    });

    it("returns 400 for invalid projectId UUID", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/projects/bad-id/dependencies",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { fromTaskId: TASK_ID, toTaskId: MILESTONE_ID },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/projects/:projectId/dependencies", () => {
    it("returns dependencies list", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/dependencies`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 403 for employee", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/dependencies`, headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("DELETE /v1/projects/:projectId/dependencies/:id", () => {
    it("returns 204 when dependency exists", async () => {
      mockState.queryResult = [{ id: DEP_ID }];
      const res = await app.inject({
        method: "DELETE", url: `/v1/projects/${PROJECT_ID}/dependencies/${DEP_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(204);
    });

    it("returns 404 when dependency not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "DELETE", url: `/v1/projects/${PROJECT_ID}/dependencies/${DEP_ID}`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 403 for employee", async () => {
      const res = await app.inject({
        method: "DELETE", url: `/v1/projects/${PROJECT_ID}/dependencies/${DEP_ID}`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Baseline Routes
// ═══════════════════════════════════════════════════════════════════
describe("Baseline Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { baselineRoutes } = await import("../src/modules/scheduling/baselines.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(baselineRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [{ id: BASELINE_ID, label: "BL-1", snapshotData: {} }];
    mockState.countResult = 1;
  });

  describe("POST /v1/projects/:id/baselines", () => {
    it("returns 201 for valid baseline", async () => {
      mockState.countResult = 0;
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/baselines`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { label: "Baseline v1", snapshotData: { tasks: [] } },
      });
      expect(res.statusCode).toBe(201);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/projects/${PROJECT_ID}/baselines`, payload: { label: "BL", snapshotData: {} } });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/baselines`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { label: "BL", snapshotData: {} },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for missing label", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/baselines`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { snapshotData: {} },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 422 when max baselines exceeded", async () => {
      mockState.countResult = 20;
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/baselines`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { label: "BL-21", snapshotData: {} },
      });
      expect(res.statusCode).toBe(422);
    });
  });

  describe("GET /v1/projects/:id/baselines", () => {
    it("returns baselines list", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/baselines`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 403 for employee", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/baselines`, headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` } });
      expect(res.statusCode).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 11. WBS Routes (Rollup & Delay Analysis)
// ═══════════════════════════════════════════════════════════════════
describe("WBS Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { wbsRoutes } = await import("../src/modules/scheduling/wbs-routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(wbsRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  describe("POST /v1/projects/:projectId/wbs/rollup", () => {
    it("returns rollup data for valid nodes", async () => {
      const nodeId1 = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
      const nodeId2 = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/wbs/rollup`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: {
          nodes: [
            { id: nodeId1, parentId: null, durationMs: 86400000, costPaise: 100000, completionPct: 50, weightPct: 1 },
            { id: nodeId2, parentId: nodeId1, durationMs: 43200000, costPaise: 50000, completionPct: 75, weightPct: 1 },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/wbs/rollup`,
        payload: { nodes: [] },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/wbs/rollup`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: { nodes: [{ id: TASK_ID, parentId: null, durationMs: 100, costPaise: 100, completionPct: 0 }] },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for empty nodes array", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/wbs/rollup`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { nodes: [] },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /v1/projects/:projectId/wbs/delay-analysis", () => {
    it("returns delay analysis for valid tasks", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/wbs/delay-analysis`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: {
          tasks: [
            { taskId: TASK_ID, actualStartMs: 1000, actualEndMs: 5000, baselineStartMs: 1000, baselineEndMs: 4000, onCriticalPath: true },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeDefined();
    });

    it("returns 400 for empty tasks array", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/${PROJECT_ID}/wbs/delay-analysis`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { tasks: [] },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid projectId", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/projects/bad-id/wbs/delay-analysis",
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { tasks: [{ taskId: TASK_ID, actualStartMs: 1000, actualEndMs: 5000, baselineStartMs: 1000, baselineEndMs: 4000, onCriticalPath: true }] },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 12. Delay Forecast Routes
// ═══════════════════════════════════════════════════════════════════
describe("Delay Forecast Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { delayForecastRoutes } = await import("../src/modules/delay-forecast/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(delayForecastRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  describe("GET /v1/projects/:projectId/delay-forecast", () => {
    it("returns forecast data", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/delay-forecast`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/${PROJECT_ID}/delay-forecast` });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 for invalid projectId", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/bad-id/delay-forecast", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 13. Mock Elimination Routes (Read-only queries)
// ═══════════════════════════════════════════════════════════════════
describe("Mock Elimination Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { mockEliminationRoutes } = await import("../src/modules/project/mock-elimination-routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(mockEliminationRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_PROJECT];
    mockState.countResult = 1;
  });

  describe("GET /v1/projects/escalations", () => {
    it("returns escalations", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/escalations", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeDefined();
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/escalations" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/escalations", headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` } });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/projects/beneficiaries", () => {
    it("returns beneficiaries", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/beneficiaries", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeDefined();
    });
  });

  describe("GET /v1/projects/dprs", () => {
    it("returns dprs", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/dprs", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /v1/projects/wbs", () => {
    it("returns wbs list", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/wbs", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });
  });

  describe("GET /v1/projects/delay-analysis", () => {
    it("returns delay analysis", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/projects/delay-analysis", headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 14. Utilisation Routes (UC Statements)
// ═══════════════════════════════════════════════════════════════════
describe("Utilisation Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { utilisationRoutes } = await import("../src/modules/utilisation/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(utilisationRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  describe("POST /v1/projects/schemes/:id/uc-statements", () => {
    const validUcPayload = {
      ucNo: "UC-2026-Q1",
      periodFrom: "2026-01-01",
      periodTo: "2026-03-31",
      releasedMinor: 3000000,
      expenditureMinor: 2500000,
      items: [{ componentId: COMPONENT_ID, releasedMinor: 3000000, expenditureMinor: 2500000 }],
    };

    it("returns 202 for valid body", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/schemes/${SCHEME_ID}/uc-statements`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: validUcPayload,
      });
      expect(res.statusCode).toBe(202);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "POST", url: `/v1/projects/schemes/${SCHEME_ID}/uc-statements`, payload: validUcPayload });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/schemes/${SCHEME_ID}/uc-statements`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
        payload: validUcPayload,
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for missing ucNo", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/projects/schemes/${SCHEME_ID}/uc-statements`,
        headers: { authorization: `Bearer ${ADMIN_TOKEN()}` },
        payload: { periodFrom: "2026-01-01", periodTo: "2026-03-31" },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /v1/projects/schemes/:id/uc-statements", () => {
    it("returns uc statements list", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/schemes/${SCHEME_ID}/uc-statements`, headers: { authorization: `Bearer ${ADMIN_TOKEN()}` } });
      expect(res.statusCode).toBe(200);
    });

    it("returns 403 for employee", async () => {
      const res = await app.inject({ method: "GET", url: `/v1/projects/schemes/${SCHEME_ID}/uc-statements`, headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` } });
      expect(res.statusCode).toBe(403);
    });
  });
});
