/**
 * ML Service Routes Tests
 *
 * Tests for models, evaluations, predictions, health, and experiments routes.
 * Uses in-memory Fastify injection (no network).
 *
 * Validates: Requirements 2.5, 2.6, 5.3, 5.5, 16.4, 24.2, 24.5
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const MODEL_ID = "33333333-3333-3333-3333-333333333333";
const MODEL_ID_2 = "44444444-4444-4444-4444-444444444444";
const ENTITY_ID = "22222222-2222-2222-2222-222222222222";
const EXPERIMENT_ID = "55555555-5555-5555-5555-555555555555";

// ─── Shared mock state (hoisted for vi.mock references) ──────────
const mockState = vi.hoisted(() => ({
  queryResult: [] as Record<string, unknown>[],
  countResult: 0,
  aggregateResult: { total: 0, avgConfidence: 0, fallbackCount: 0 } as Record<string, unknown>,
  groupByResult: [] as Record<string, unknown>[],
  insertResult: null as Record<string, unknown> | null,
  updateResult: null as Record<string, unknown> | null,
  promoteResult: true,
}));

// ─── DB Mock — simple fluent chain ───────────────────────────────
vi.mock("../src/shared/db.js", () => {
  function chain(data: unknown[]) {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => c;
    c.groupBy = () => mockState.groupByResult;
    c.limit = (n: number) => {
      const sliced = (data as unknown[]).slice(0, n);
      // limit returns the array but may have .offset chained
      return Object.assign(sliced, { offset: () => sliced });
    };
    c.offset = () => data;
    return c;
  }

  return {
    db: {
      select: (fields?: Record<string, unknown>) => {
        // Count queries (have a "count" field)
        if (fields && Object.keys(fields).some((k) => k === "count")) {
          const countArr = Object.assign([{ count: mockState.countResult }], {
            groupBy: () => mockState.groupByResult,
          });
          return { from: () => ({ where: () => countArr }) };
        }
        // Aggregate queries (evaluations) — detect by field names
        if (fields && Object.keys(fields).length >= 3 &&
            Object.keys(fields).some((k) => k === "total" || k === "avgConfidence")) {
          // For groupBy queries (domain breakdown), where().groupBy() returns array
          // For single aggregate queries, where() returns [result]
          const result = Object.assign([mockState.aggregateResult], {
            groupBy: () => mockState.groupByResult,
          });
          return { from: () => ({ where: () => result }) };
        }
        // Domain/count aggregate for health
        if (fields && Object.keys(fields).some((k) => k === "domain") &&
            Object.keys(fields).some((k) => k === "count")) {
          return { from: () => ({ where: () => ({ groupBy: () => mockState.groupByResult }) }) };
        }
        // Regular select — return queryResult
        return chain(mockState.queryResult);
      },
      insert: () => ({
        values: () => ({
          returning: () => [mockState.insertResult ?? { id: "new-id" }],
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => ({
            returning: () => [mockState.updateResult ?? { id: "updated" }],
          }),
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          update: () => ({ set: () => ({ where: () => ({ returning: () => [{}] }) }) }),
          insert: () => ({ values: () => ({ returning: () => [{}] }) }),
          select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => [] }) }) }) }),
        };
        return fn(tx);
      },
    },
    sqlClient: {},
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async <T>(_key: string, loader: () => Promise<T>) => loader(),
    put: async () => {},
    invalidate: async () => {},
  },
  queue: { publish: async () => {} },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: async () => {},
  markProcessed: async () => {},
}));

vi.mock("../src/modules/model-registry/domain.js", () => ({
  getCurrentModel: async () => null,
  promote: async () => mockState.promoteResult,
  meetsPromotionCriteria: () => true,
}));

vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: async (app: FastifyInstance) => {
    app.decorateRequest("user", null);
    app.addHook("onRequest", async (req) => {
      // @ts-expect-error — route config
      if (req.routeOptions?.config?.public === true) return;
      const authHeader = req.headers.authorization;
      if (!authHeader) return;
      const token = authHeader.replace("Bearer ", "");
      try {
        const [, payload] = token.split(".");
        const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString());
        (req as unknown as Record<string, unknown>).user = decoded;
      } catch { /* no-op */ }
    });
  },
}));

vi.mock("@civitasone/auth/context", () => {
  class AuthContextError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    resolveServiceContext: (req: { headers: { authorization?: string } }) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        throw new AuthContextError(401, "UNAUTHORIZED", "unauthorized");
      }
      const token = authHeader.replace("Bearer ", "");
      const [, payload] = token.split(".");
      const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString());
      return {
        tenantId: decoded.tid,
        actorId: decoded.sub,
        roles: decoded.roles ?? [],
        sessionId: decoded.sid ?? "test-session",
      };
    },
    AuthContextError,
  };
});

vi.mock("@civitasone/db", () => ({
  createSqlClient: () => ({}),
  createTenantTxHook: () => async () => {},
}));

vi.mock("@civitasone/observability", () => ({
  registerOpsRoutes: () => {},
  dbPing: async () => true,
}));

vi.mock("@civitasone/schemas/plugin", () => ({
  registerSchemaErrorHandler: () => {},
}));

vi.mock("@fastify/cors", () => ({ default: async () => {} }));

// ─── Token helpers ────────────────────────────────────────────────
function makeToken(roles: string[], tenantId = TENANT_ID): string {
  return signToken(
    { sub: ACTOR_ID, tid: tenantId, roles, sid: "sess-1" },
    JWT_SECRET,
    3600,
  );
}
const ML_ADMIN_TOKEN = () => makeToken(["ml_admin"]);
const TENANT_ADMIN_TOKEN = () => makeToken(["tenant_admin"]);
const ANALYTICS_ADMIN_TOKEN = () => makeToken(["analytics_admin"]);
const NO_ROLE_TOKEN = () => makeToken(["employee"]);

// ─── Seed model data ─────────────────────────────────────────────
const SEED_MODEL = {
  id: MODEL_ID,
  tenantId: TENANT_ID,
  domain: "leads",
  version: 1,
  status: "candidate",
  s3Key: `ml-models/${TENANT_ID}/leads/1/model.json`,
  trainedAt: new Date("2024-06-01"),
  recordCount: 500,
  metrics: { aucRoc: 0.82 },
  featureList: ["daysInStage"],
  modelCard: { limitations: ["small set"], biasCheckResults: [] },
  createdAt: new Date("2024-06-01"),
  updatedAt: new Date("2024-06-01"),
  createdBy: ACTOR_ID,
  updatedBy: ACTOR_ID,
  versionLock: 1,
};

const SEED_EXPERIMENT = {
  id: EXPERIMENT_ID,
  tenantId: TENANT_ID,
  domain: "leads",
  name: "Test Experiment",
  challengerModelId: MODEL_ID,
  currentModelId: MODEL_ID_2,
  splitPct: 50,
  status: "active",
  startedAt: new Date(),
  endedAt: null,
  createdBy: ACTOR_ID,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ═══════════════════════════════════════════════════════════════════
// Model Routes
// ═══════════════════════════════════════════════════════════════════
describe("Model Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { modelRoutes } = await import("../src/modules/models/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(modelRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_MODEL];
    mockState.countResult = 1;
    mockState.promoteResult = true;
  });

  describe("GET /v1/ml/models", () => {
    it("returns paginated list for ml_admin", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/ml/models",
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    });

    it("returns paginated list for tenant_admin", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/ml/models",
        headers: { authorization: `Bearer ${TENANT_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without auth header", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/ml/models" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/ml/models",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/ml/models/:id", () => {
    it("returns model detail for ml_admin", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/ml/models/${MODEL_ID}`,
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.id).toBe(MODEL_ID);
    });

    it("returns 404 when model not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "GET", url: `/v1/ml/models/${MODEL_ID}`,
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 400 for invalid UUID param", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/ml/models/not-a-uuid",
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/ml/models/${MODEL_ID}`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/ml/models/:id/promote", () => {
    it("promotes candidate model for ml_admin", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/ml/models/${MODEL_ID}/promote`,
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.promoted).toBe(true);
    });

    it("returns 422 when model is not candidate", async () => {
      mockState.queryResult = [{ ...SEED_MODEL, status: "active" }];
      const res = await app.inject({
        method: "POST", url: `/v1/ml/models/${MODEL_ID}/promote`,
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(422);
    });

    it("returns 404 when model not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "POST", url: `/v1/ml/models/${MODEL_ID}/promote`,
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "POST", url: `/v1/ml/models/${MODEL_ID}/promote`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /v1/ml/models/:id/card", () => {
    it("returns model card for ml_admin", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/ml/models/${MODEL_ID}/card`,
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toBeDefined();
    });

    it("returns model card for analytics_admin", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/ml/models/${MODEL_ID}/card`,
        headers: { authorization: `Bearer ${ANALYTICS_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when no model card available", async () => {
      mockState.queryResult = [{ ...SEED_MODEL, modelCard: null }];
      const res = await app.inject({
        method: "GET", url: `/v1/ml/models/${MODEL_ID}/card`,
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("NO_MODEL_CARD");
    });

    it("returns 403 for employee role", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/ml/models/${MODEL_ID}/card`,
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 403 for tenant_admin (not in card roles)", async () => {
      const res = await app.inject({
        method: "GET", url: `/v1/ml/models/${MODEL_ID}/card`,
        headers: { authorization: `Bearer ${TENANT_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Health Routes
// ═══════════════════════════════════════════════════════════════════
describe("Health Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { healthRoutes } = await import("../src/modules/health/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(healthRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    delete process.env.FEATURE_ML_ENABLED;
    mockState.groupByResult = [];
  });

  describe("GET /v1/ml/health", () => {
    it("returns disabled status when feature flag is off", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/ml/health" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.status).toBe("disabled");
      expect(body.data.featureEnabled).toBe(false);
      expect(body.data.domains).toHaveLength(6);
    });

    it("returns status when feature enabled", async () => {
      process.env.FEATURE_ML_ENABLED = "true";
      mockState.groupByResult = [{ domain: "leads", count: 2 }];
      const res = await app.inject({ method: "GET", url: "/v1/ml/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.featureEnabled).toBe(true);
    });

    it("requires no authentication (public)", async () => {
      // No auth header — should still work
      const res = await app.inject({ method: "GET", url: "/v1/ml/health" });
      expect(res.statusCode).toBe(200);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Evaluation Routes
// ═══════════════════════════════════════════════════════════════════
describe("Evaluation Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { evaluationRoutes } = await import("../src/modules/evaluations/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(evaluationRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.aggregateResult = { total: 100, avgConfidence: 0.75, fallbackCount: 10 };
    mockState.groupByResult = [{ domain: "leads", total: 60, avgConfidence: 0.8, fallbackCount: 5 }];
  });

  describe("GET /v1/ml/evaluations", () => {
    it("returns aggregated metrics for ml_admin", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/ml/evaluations?window=30d",
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.window).toBe("30d");
      expect(body.data.totalPredictions).toBe(100);
    });

    it("returns aggregated metrics for analytics_admin", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/ml/evaluations",
        headers: { authorization: `Bearer ${ANALYTICS_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/ml/evaluations" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for insufficient role", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/ml/evaluations",
        headers: { authorization: `Bearer ${NO_ROLE_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("accepts 7d window parameter", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/ml/evaluations?window=7d",
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.window).toBe("7d");
    });

    it("returns 400 for invalid window parameter", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/ml/evaluations?window=invalid",
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Prediction Routes
// ═══════════════════════════════════════════════════════════════════
describe("Prediction Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { predictionRoutes } = await import("../src/modules/predictions/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(predictionRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [{
      id: "66666666-6666-6666-6666-666666666666",
      tenantId: TENANT_ID,
      domain: "leads",
      entityId: ENTITY_ID,
      modelId: MODEL_ID,
      experimentId: null,
      prediction: "0.7200",
      confidence: "0.8500",
      factors: [{ feature: "daysInStage", contribution: 0.45, direction: "positive" }],
      isFallback: false,
      fallbackReason: null,
      actualOutcome: null,
      userDecision: null,
      createdAt: new Date("2024-06-15T12:00:00Z"),
    }];
    mockState.countResult = 1;
  });

  describe("GET /v1/ml/predictions", () => {
    it("returns prediction history for authenticated user", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/ml/predictions?entityId=${ENTITY_ID}&domain=leads`,
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/ml/predictions?entityId=${ENTITY_ID}&domain=leads`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 400 for missing entityId", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/ml/predictions?domain=leads",
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid domain", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/v1/ml/predictions?entityId=${ENTITY_ID}&domain=invalid`,
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for non-UUID entityId", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/ml/predictions?entityId=bad&domain=leads",
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Experiment Routes
// ═══════════════════════════════════════════════════════════════════
describe("Experiment Routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { experimentRoutes } = await import("../src/modules/experiments/routes.js");
    app = Fastify({ logger: false });
    const { authPlugin } = await import("@civitasone/auth/plugin");
    await app.register(authPlugin);
    await app.register(experimentRoutes);
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  beforeEach(() => {
    mockState.queryResult = [SEED_EXPERIMENT];
    mockState.countResult = 1;
    mockState.insertResult = SEED_EXPERIMENT;
    mockState.updateResult = { ...SEED_EXPERIMENT, status: "completed", endedAt: new Date() };
  });

  describe("GET /v1/ml/experiments", () => {
    it("returns experiments list for ml_admin", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/ml/experiments",
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({ method: "GET", url: "/v1/ml/experiments" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for non-ml_admin role", async () => {
      const res = await app.inject({
        method: "GET", url: "/v1/ml/experiments",
        headers: { authorization: `Bearer ${TENANT_ADMIN_TOKEN()}` },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /v1/ml/experiments", () => {
    it("creates experiment for ml_admin", async () => {
      // Set models for validation lookup
      mockState.queryResult = [
        { id: MODEL_ID, tenantId: TENANT_ID, domain: "leads" },
        { id: MODEL_ID_2, tenantId: TENANT_ID, domain: "leads" },
      ];
      const res = await app.inject({
        method: "POST", url: "/v1/ml/experiments",
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
        payload: {
          domain: "leads",
          name: "New Experiment",
          challengerModelId: MODEL_ID,
          currentModelId: MODEL_ID_2,
          splitPct: 50,
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().data).toBeDefined();
    });

    it("returns 400 for missing required fields", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/ml/experiments",
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
        payload: { domain: "leads" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for invalid domain", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/ml/experiments",
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
        payload: {
          domain: "bad_domain",
          name: "Test",
          challengerModelId: MODEL_ID,
          currentModelId: MODEL_ID_2,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for non-ml_admin", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/ml/experiments",
        headers: { authorization: `Bearer ${TENANT_ADMIN_TOKEN()}` },
        payload: {
          domain: "leads",
          name: "Test",
          challengerModelId: MODEL_ID,
          currentModelId: MODEL_ID_2,
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 401 without auth", async () => {
      const res = await app.inject({
        method: "POST", url: "/v1/ml/experiments",
        payload: {
          domain: "leads",
          name: "Test",
          challengerModelId: MODEL_ID,
          currentModelId: MODEL_ID_2,
        },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /v1/ml/experiments/:id", () => {
    it("ends an active experiment for ml_admin", async () => {
      mockState.queryResult = [SEED_EXPERIMENT];
      const res = await app.inject({
        method: "PATCH", url: `/v1/ml/experiments/${EXPERIMENT_ID}`,
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
        payload: { status: "completed" },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 404 when experiment not found", async () => {
      mockState.queryResult = [];
      const res = await app.inject({
        method: "PATCH", url: `/v1/ml/experiments/${EXPERIMENT_ID}`,
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
        payload: { status: "cancelled" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 422 when experiment already ended", async () => {
      mockState.queryResult = [{ ...SEED_EXPERIMENT, status: "completed" }];
      const res = await app.inject({
        method: "PATCH", url: `/v1/ml/experiments/${EXPERIMENT_ID}`,
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
        payload: { status: "completed" },
      });
      expect(res.statusCode).toBe(422);
    });

    it("returns 400 for invalid status value", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/ml/experiments/${EXPERIMENT_ID}`,
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
        payload: { status: "invalid" },
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 403 for non-ml_admin", async () => {
      const res = await app.inject({
        method: "PATCH", url: `/v1/ml/experiments/${EXPERIMENT_ID}`,
        headers: { authorization: `Bearer ${TENANT_ADMIN_TOKEN()}` },
        payload: { status: "completed" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 for non-UUID id param", async () => {
      const res = await app.inject({
        method: "PATCH", url: "/v1/ml/experiments/not-uuid",
        headers: { authorization: `Bearer ${ML_ADMIN_TOKEN()}` },
        payload: { status: "completed" },
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
