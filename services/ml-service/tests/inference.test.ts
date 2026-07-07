/**
 * Inference Engine Tests
 *
 * Tests for POST /v1/ml/predict route and inference domain logic.
 * Uses in-memory Fastify injection (no network).
 *
 * Validates: Requirements 3.1, 3.5, 3.6, 14.1, 15.1, 15.2, 15.3, 16.1, 16.5, 17.2
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { inferenceRoutes } from "../src/modules/inference/routes.js";

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const OTHER_TENANT = "99999999-9999-9999-9999-999999999999";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const ENTITY_ID = "22222222-2222-2222-2222-222222222222";

// Mock external dependencies
vi.mock("../src/shared/db.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }),
    insert: () => ({ values: () => ({ returning: () => [{}] }) }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn({
      insert: () => ({ values: () => ({ returning: () => [{}] }) }),
    }),
  },
  sqlClient: {},
}));

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
}));

vi.mock("../src/modules/feature-store/domain.js", () => ({
  getFeatureVector: async () => null,
}));

vi.mock("../src/modules/algorithms/logistic-regression.js", () => ({
  predictLogistic: () => 0.72,
  computeFeatureImportance: () => [
    { feature: "daysInStage", contribution: 0.45, direction: "positive" as const },
    { feature: "interactionCount", contribution: 0.35, direction: "positive" as const },
    { feature: "dealValueBucket", contribution: 0.20, direction: "negative" as const },
  ],
}));

// Auth plugin mock for JWT decoding
vi.mock("@civitasone/auth/plugin", () => ({
  authPlugin: async (app: FastifyInstance) => {
    app.decorateRequest("user", null);
    app.addHook("onRequest", async (req) => {
      const authHeader = req.headers.authorization;
      if (authHeader) {
        const token = authHeader.replace("Bearer ", "");
        try {
          // Simple decode for test (no verify needed with HS256 bypass)
          const [, payload] = token.split(".");
          const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString());
          (req as unknown as Record<string, unknown>).user = decoded;
        } catch { /* no-op */ }
      }
    });
  },
}));

vi.mock("@civitasone/auth/context", () => ({
  resolveServiceContext: (req: { headers: { authorization?: string } }) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      const err = new Error("unauthorized");
      (err as Record<string, unknown>).status = 401;
      (err as Record<string, unknown>).code = "UNAUTHORIZED";
      throw err;
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
  AuthContextError: class AuthContextError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

function makeToken(tenantId: string): string {
  return signToken(
    { sub: ACTOR_ID, tid: tenantId, roles: ["tenant_admin"], sid: "sess-1" },
    JWT_SECRET,
    3600,
  );
}

describe("POST /v1/ml/predict", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(inferenceRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Reset FEATURE_ML_ENABLED for each test
    delete process.env.FEATURE_ML_ENABLED;
  });

  describe("feature flag gating", () => {
    it("returns fallback when FEATURE_ML_ENABLED is not set", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/ml/predict",
        headers: { authorization: `Bearer ${makeToken(TENANT_ID)}` },
        payload: {
          domain: "leads",
          entityId: ENTITY_ID,
          tenantId: TENANT_ID,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.prediction).toBeNull();
      expect(body.confidence).toBe(0);
      expect(body.factors).toEqual([]);
      expect(body.fallback).toBe(true);
      expect(body.reason).toBe("feature_disabled");
      expect(body.advisory).toBe(true);
    });

    it("returns fallback when FEATURE_ML_ENABLED is 'false'", async () => {
      process.env.FEATURE_ML_ENABLED = "false";
      const res = await app.inject({
        method: "POST",
        url: "/v1/ml/predict",
        headers: { authorization: `Bearer ${makeToken(TENANT_ID)}` },
        payload: {
          domain: "leads",
          entityId: ENTITY_ID,
          tenantId: TENANT_ID,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().fallback).toBe(true);
      expect(res.json().reason).toBe("feature_disabled");
    });
  });

  describe("request validation", () => {
    it("returns 400 for missing required fields", async () => {
      process.env.FEATURE_ML_ENABLED = "true";
      const res = await app.inject({
        method: "POST",
        url: "/v1/ml/predict",
        headers: { authorization: `Bearer ${makeToken(TENANT_ID)}` },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_FAILED");
    });

    it("returns 400 for invalid domain", async () => {
      process.env.FEATURE_ML_ENABLED = "true";
      const res = await app.inject({
        method: "POST",
        url: "/v1/ml/predict",
        headers: { authorization: `Bearer ${makeToken(TENANT_ID)}` },
        payload: {
          domain: "invalid_domain",
          entityId: ENTITY_ID,
          tenantId: TENANT_ID,
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for non-UUID entityId", async () => {
      process.env.FEATURE_ML_ENABLED = "true";
      const res = await app.inject({
        method: "POST",
        url: "/v1/ml/predict",
        headers: { authorization: `Bearer ${makeToken(TENANT_ID)}` },
        payload: {
          domain: "leads",
          entityId: "not-a-uuid",
          tenantId: TENANT_ID,
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe("tenant validation", () => {
    it("returns 403 when JWT tenantId does not match request tenantId", async () => {
      process.env.FEATURE_ML_ENABLED = "true";
      const res = await app.inject({
        method: "POST",
        url: "/v1/ml/predict",
        headers: { authorization: `Bearer ${makeToken(TENANT_ID)}` },
        payload: {
          domain: "leads",
          entityId: ENTITY_ID,
          tenantId: OTHER_TENANT,
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("TENANT_MISMATCH");
    });
  });

  describe("inference execution", () => {
    it("returns fallback when no model is available (model_unavailable)", async () => {
      process.env.FEATURE_ML_ENABLED = "true";
      const res = await app.inject({
        method: "POST",
        url: "/v1/ml/predict",
        headers: { authorization: `Bearer ${makeToken(TENANT_ID)}` },
        payload: {
          domain: "leads",
          entityId: ENTITY_ID,
          tenantId: TENANT_ID,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.fallback).toBe(true);
      expect(body.advisory).toBe(true);
      // Since model is mocked as null, should return fallback
      expect(body.prediction).toBeNull();
    });

    it("never returns HTTP 5xx — always 200 with fallback on errors", async () => {
      process.env.FEATURE_ML_ENABLED = "true";
      const res = await app.inject({
        method: "POST",
        url: "/v1/ml/predict",
        headers: { authorization: `Bearer ${makeToken(TENANT_ID)}` },
        payload: {
          domain: "tickets",
          entityId: ENTITY_ID,
          tenantId: TENANT_ID,
        },
      });

      // Should always be 200 (or 400/403 for validation issues)
      expect(res.statusCode).toBeLessThan(500);
    });

    it("includes advisory: true on all responses", async () => {
      process.env.FEATURE_ML_ENABLED = "true";
      const res = await app.inject({
        method: "POST",
        url: "/v1/ml/predict",
        headers: { authorization: `Bearer ${makeToken(TENANT_ID)}` },
        payload: {
          domain: "inventory",
          entityId: ENTITY_ID,
          tenantId: TENANT_ID,
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().advisory).toBe(true);
    });

    it("accepts optional features override", async () => {
      process.env.FEATURE_ML_ENABLED = "true";
      const res = await app.inject({
        method: "POST",
        url: "/v1/ml/predict",
        headers: { authorization: `Bearer ${makeToken(TENANT_ID)}` },
        payload: {
          domain: "leads",
          entityId: ENTITY_ID,
          tenantId: TENANT_ID,
          features: { daysInStage: 5, interactionCount: 12, dealValueBucket: 3 },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.advisory).toBe(true);
    });

    it("accepts optional experimentId for A/B routing", async () => {
      process.env.FEATURE_ML_ENABLED = "true";
      const res = await app.inject({
        method: "POST",
        url: "/v1/ml/predict",
        headers: { authorization: `Bearer ${makeToken(TENANT_ID)}` },
        payload: {
          domain: "leads",
          entityId: ENTITY_ID,
          tenantId: TENANT_ID,
          experimentId: "exp-123-abc",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().advisory).toBe(true);
    });
  });

  describe("response shape", () => {
    it("fallback response has correct shape", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v1/ml/predict",
        headers: { authorization: `Bearer ${makeToken(TENANT_ID)}` },
        payload: {
          domain: "leads",
          entityId: ENTITY_ID,
          tenantId: TENANT_ID,
        },
      });

      const body = res.json();
      expect(body).toHaveProperty("prediction");
      expect(body).toHaveProperty("confidence");
      expect(body).toHaveProperty("factors");
      expect(body).toHaveProperty("fallback");
      expect(body).toHaveProperty("advisory");
      expect(Array.isArray(body.factors)).toBe(true);
      expect(typeof body.confidence).toBe("number");
      expect(typeof body.fallback).toBe("boolean");
    });
  });
});
