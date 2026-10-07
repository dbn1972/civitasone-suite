/**
 * ML evaluations fallbackRate semantics — GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-06.
 *
 * The audit asked whether the evaluations `fallbackRate` is the RULE-BASED
 * fallback share (count of predictions that used the deterministic fallback
 * path, over total) or whether it is a mislabelled FALSE-POSITIVE rate, and
 * whether a separate `falsePositiveRate` should exist.
 *
 * These tests pin the backend contract: `fallbackRate = fallbackCount / total`
 * where `fallbackCount` counts predictions with `isFallback = true`, and the
 * response does NOT emit a `falsePositiveRate` field. The anomalies web page
 * therefore honestly labels this stat "Fallback Rate" (not "False Positive
 * Rate"). The two measures are different and only the fallback share is
 * computed server-side.
 *
 * In-memory Fastify injection with a mocked DB/auth, mirroring
 * tests/routes.test.ts and tests/export-audit-route.test.ts (ml-service has
 * no live-DB evaluations harness).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";

const mockState = vi.hoisted(() => ({
  aggregate: { total: 0, avgConfidence: 0, fallbackCount: 0 } as Record<string, unknown>,
  groupBy: [] as Record<string, unknown>[],
}));

// Minimal fluent DB mock: the evaluations handler runs two aggregate selects
// inside db.transaction — one bare .where() (overall) and one .where().groupBy()
// (per-domain). Return the overall aggregate from .where() and the breakdown
// from .groupBy().
vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () =>
              Object.assign([mockState.aggregate], { groupBy: () => mockState.groupBy }),
          }),
        }),
      };
      return fn(tx);
    },
  },
  sqlClient: {},
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
      if (!authHeader) throw new AuthContextError(401, "UNAUTHORIZED", "unauthorized");
      const token = authHeader.replace("Bearer ", "");
      const [, payload] = token.split(".");
      const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString());
      return {
        tenantId: decoded.tid,
        actorId: decoded.sub,
        roles: decoded.roles ?? [],
        sessionId: decoded.sid ?? "test-session",
        correlationId: "test-correlation-id",
      };
    },
    AuthContextError,
  };
});

function makeToken(roles: string[]): string {
  return signToken({ sub: ACTOR_ID, tid: TENANT_ID, roles, sid: "sess-1" }, JWT_SECRET, 3600);
}

describe("GAP-ANALYTICS-ML-INSIGHTS-ANOMALIES-06: fallbackRate is the rule-based fallback share", () => {
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

  it("computes fallbackRate = fallbackCount / total (10 of 100 => 0.10)", async () => {
    // Given 100 anomaly predictions, 10 of which used the rule-based fallback.
    mockState.aggregate = { total: 100, avgConfidence: 0.9, fallbackCount: 10 };
    mockState.groupBy = [{ domain: "transactions", total: 100, avgConfidence: 0.9, fallbackCount: 10 }];

    const res = await app.inject({
      method: "GET",
      url: "/v1/ml/evaluations?domain=transactions&window=30d",
      headers: { authorization: `Bearer ${makeToken(["analytics_admin"])}` },
    });

    expect(res.statusCode).toBe(200);
    const data = res.json().data as Record<string, unknown>;
    expect(data.fallbackRate).toBe(0.1);
    expect(data.fallbackCount).toBe(10);
  });

  it("does NOT emit a separate falsePositiveRate field (fallback != false positive)", async () => {
    mockState.aggregate = { total: 100, avgConfidence: 0.9, fallbackCount: 10 };
    mockState.groupBy = [{ domain: "transactions", total: 100, avgConfidence: 0.9, fallbackCount: 10 }];

    const res = await app.inject({
      method: "GET",
      url: "/v1/ml/evaluations?domain=transactions&window=30d",
      headers: { authorization: `Bearer ${makeToken(["analytics_admin"])}` },
    });

    const data = res.json().data as Record<string, unknown>;
    expect(data).not.toHaveProperty("falsePositiveRate");
    // The per-domain breakdown carries fallbackRate too, never an FPR.
    const domains = data.domains as Array<Record<string, unknown>>;
    expect(domains[0]!.fallbackRate).toBe(0.1);
    expect(domains[0]).not.toHaveProperty("falsePositiveRate");
  });

  it("fallbackRate is 0 (not NaN) when there are no predictions", async () => {
    mockState.aggregate = { total: 0, avgConfidence: 0, fallbackCount: 0 };
    mockState.groupBy = [];

    const res = await app.inject({
      method: "GET",
      url: "/v1/ml/evaluations?domain=transactions&window=30d",
      headers: { authorization: `Bearer ${makeToken(["ml_admin"])}` },
    });

    const data = res.json().data as Record<string, unknown>;
    expect(data.fallbackRate).toBe(0);
  });
});
