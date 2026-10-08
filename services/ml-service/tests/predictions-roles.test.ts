/**
 * GAP2-ML-PREDICTIONS-01
 *
 * GET /v1/ml/predictions used to perform NO requireRole check — any
 * authenticated tenant user could read model predictions, confidence scores
 * and factor explanations. The read is now role-gated to the ML reader set
 * (ml_admin / analytics_admin / super_admin), matching GET /v1/ml/evaluations.
 *
 * A token with no ML/analytics role must get 403 (today it got 200). An
 * ml_admin still gets 200.
 *
 * In-memory Fastify injection with a mocked DB (no network).
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const JWT_SECRET = "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const ENTITY_ID = "22222222-2222-2222-2222-222222222222";

const mockState = vi.hoisted(() => ({ queryResult: [] as Record<string, unknown>[], countResult: 0 }));

vi.mock("../src/shared/db.js", () => {
  function chain(data: unknown[]) {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => c;
    c.groupBy = () => [];
    c.limit = (n: number) => { const s = (data as unknown[]).slice(0, n); return Object.assign(s, { offset: () => s }); };
    c.offset = () => data;
    return c;
  }
  function select(fields?: Record<string, unknown>) {
    if (fields && Object.keys(fields).some((k) => k === "count")) {
      return { from: () => ({ where: () => [{ count: mockState.countResult }] }) };
    }
    return chain(mockState.queryResult);
  }
  return {
    db: { select, transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ select }) },
    sqlClient: {},
  };
});

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
  return signToken({ sub: ACTOR_ID, tid: TENANT_ID, roles, sid: "sess-1" }, JWT_SECRET, 3600);
}

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
    id: "66666666-6666-6666-6666-666666666666", tenantId: TENANT_ID, domain: "leads",
    entityId: ENTITY_ID, modelId: "m1", experimentId: null, prediction: "0.72", confidence: "0.85",
    factors: [], isFallback: false, fallbackReason: null, actualOutcome: null, userDecision: null,
    createdAt: new Date("2024-06-15T12:00:00Z"),
  }];
  mockState.countResult = 1;
});

const url = `/v1/ml/predictions?entityId=${ENTITY_ID}&domain=leads`;

describe("GAP2-ML-PREDICTIONS-01: prediction history is role-gated", () => {
  it("returns 403 for a token with no ML/analytics role (was 200 before the fix)", async () => {
    const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token(["employee"])}` } });
    expect(res.statusCode).toBe(403);
  });

  it("still returns 200 for ml_admin", async () => {
    const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token(["ml_admin"])}` } });
    expect(res.statusCode).toBe(200);
  });

  it("returns 200 for analytics_admin", async () => {
    const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token(["analytics_admin"])}` } });
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without a token", async () => {
    const res = await app.inject({ method: "GET", url });
    expect(res.statusCode).toBe(401);
  });
});
