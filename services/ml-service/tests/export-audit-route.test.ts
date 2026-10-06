/**
 * ML export-audit route tests — GAP-ANALYTICS-ML-INSIGHTS-*-07/08.
 *
 * POST /v1/ml/predictions/export-audit records a CSV export of scored
 * predictions in the audit trail. Role-gated to the same roles as the
 * evaluations read; the raw search text is never accepted (only a boolean).
 *
 * In-memory Fastify injection with a mocked DB/outbox, mirroring
 * tests/routes.test.ts (ml-service has no live-DB test harness).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";

const mockState = vi.hoisted(() => ({
  enqueued: [] as Record<string, unknown>[],
}));

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  },
  sqlClient: {},
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: async (_tx: unknown, event: Record<string, unknown>) => {
    mockState.enqueued.push(event);
  },
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

describe("POST /v1/ml/predictions/export-audit", () => {
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

  it("records an audit event for an authorised exporter", async () => {
    mockState.enqueued = [];
    const res = await app.inject({
      method: "POST",
      url: "/v1/ml/predictions/export-audit",
      headers: { authorization: `Bearer ${makeToken(["analytics_admin"])}` },
      payload: { domain: "leads", rowCount: 42, filtered: true },
    });
    expect(res.statusCode).toBe(202);
    expect(mockState.enqueued).toHaveLength(1);
    const event = mockState.enqueued[0]!;
    expect(event.eventType).toBe("ml.predictions.export");
    expect(event.tenantId).toBe(TENANT_ID);
    expect(event.actorId).toBe(ACTOR_ID);
    const payload = event.payload as Record<string, unknown>;
    expect(payload.domain).toBe("leads");
    expect(payload.rowCount).toBe(42);
    expect(payload.filtered).toBe(true);
  });

  it("returns 401 without auth and records nothing", async () => {
    mockState.enqueued = [];
    const res = await app.inject({
      method: "POST",
      url: "/v1/ml/predictions/export-audit",
      payload: { domain: "leads", rowCount: 1, filtered: false },
    });
    expect(res.statusCode).toBe(401);
    expect(mockState.enqueued).toHaveLength(0);
  });

  it("returns 403 for a role outside the export allow-list", async () => {
    mockState.enqueued = [];
    const res = await app.inject({
      method: "POST",
      url: "/v1/ml/predictions/export-audit",
      headers: { authorization: `Bearer ${makeToken(["employee"])}` },
      payload: { domain: "leads", rowCount: 1, filtered: false },
    });
    expect(res.statusCode).toBe(403);
    expect(mockState.enqueued).toHaveLength(0);
  });

  it("rejects an unknown domain with 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ml/predictions/export-audit",
      headers: { authorization: `Bearer ${makeToken(["ml_admin"])}` },
      payload: { domain: "not-a-domain", rowCount: 1, filtered: false },
    });
    expect(res.statusCode).toBe(400);
  });

  it("never stores raw search text (only a filtered boolean is accepted)", async () => {
    mockState.enqueued = [];
    const res = await app.inject({
      method: "POST",
      url: "/v1/ml/predictions/export-audit",
      headers: { authorization: `Bearer ${makeToken(["ml_admin"])}` },
      // An extra `filter` string must be stripped by the schema, not persisted.
      payload: { domain: "transactions", rowCount: 3, filtered: true, filter: "secret-search" },
    });
    expect(res.statusCode).toBe(202);
    const payload = mockState.enqueued[0]!.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("filter");
    expect(JSON.stringify(payload)).not.toContain("secret-search");
  });
});
