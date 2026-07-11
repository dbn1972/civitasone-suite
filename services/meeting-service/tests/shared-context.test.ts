/**
 * shared/context.ts — unit tests (task 19.3)
 *
 * Validates the shared infrastructure: resolveContext JWT extraction, requireRole
 * role gating, httpError factory, toErrorEnvelope serialisation, and ERROR_CODES
 * mapping — all without a running database (pure logic layer).
 *
 * Uses HS256 test JWTs (vitest.config.ts: JWT_ALGORITHM=HS256, JWT_SECRET).
 * Requirements: 15.1 (multi-tenant), 15.3 (PII compliance), 16.2 (CERT-In audit).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import {
  ERROR_CODES,
  HttpError,
  httpError,
  resolveContext,
  requireRole,
  toErrorEnvelope,
} from "../src/shared/context.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-ctx1-4000-8000-000000000001";
const ACTOR = "bbbbbbbb-ctx1-4000-8000-000000000001";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

// ─── resolveContext ──────────────────────────────────────────────────────────

describe("resolveContext (Req 15.1 — multi-tenant JWT extraction)", () => {
  it("extracts tenantId, actorId, and roles from a valid JWT", async () => {
    const tok = signToken(
      { sub: ACTOR, tid: TENANT, roles: ["committee_secretary", "hr_officer"], sid: "sess-ctx" },
      SECRET,
      3600,
    );

    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { authorization: `Bearer ${tok}` },
    });

    // /health is unauthenticated — but we can test resolveContext directly via
    // a dummy route. Instead, let's call a real protected route and verify the
    // context produced by inspecting the response (the route uses resolveContext).
    // Simpler: invoke resolveContext on a fabricated Fastify request object.
    // We use the inject pattern to ensure the auth pipeline fully resolves.
    expect(res.statusCode).toBeLessThan(500);

    // Direct invocation test via a minimal mock request (more precise):
    const mockReq = {
      headers: {
        authorization: `Bearer ${tok}`,
        "x-correlation-id": "corr-test-001",
      },
      id: "req-fallback-id",
    } as unknown as import("fastify").FastifyRequest;

    const ctx = resolveContext(mockReq);
    expect(ctx.tenantId).toBe(TENANT);
    expect(ctx.actorId).toBe(ACTOR);
    expect(ctx.roles).toContain("committee_secretary");
    expect(ctx.roles).toContain("hr_officer");
    expect(ctx.correlationId).toBe("corr-test-001");
  });

  it("falls back to req.id when x-correlation-id header is missing", async () => {
    const tok = signToken(
      { sub: ACTOR, tid: TENANT, roles: ["super_admin"], sid: "sess-2" },
      SECRET,
      3600,
    );

    const mockReq = {
      headers: { authorization: `Bearer ${tok}` },
      id: "generated-req-id-42",
    } as unknown as import("fastify").FastifyRequest;

    const ctx = resolveContext(mockReq);
    expect(ctx.correlationId).toBe("generated-req-id-42");
  });

  it("includes idempotencyKey when x-idempotency-key header is present", async () => {
    const tok = signToken(
      { sub: ACTOR, tid: TENANT, roles: ["super_admin"], sid: "sess-3" },
      SECRET,
      3600,
    );

    const mockReq = {
      headers: {
        authorization: `Bearer ${tok}`,
        "x-correlation-id": "corr-idem",
        "x-idempotency-key": "idem-key-abc",
      },
      id: "req-id",
    } as unknown as import("fastify").FastifyRequest;

    const ctx = resolveContext(mockReq);
    expect(ctx.idempotencyKey).toBe("idem-key-abc");
  });

  it("throws HttpError 401 when no authorization header is present", () => {
    const mockReq = {
      headers: {},
      id: "req-no-auth",
    } as unknown as import("fastify").FastifyRequest;

    expect(() => resolveContext(mockReq)).toThrow(HttpError);
    try {
      resolveContext(mockReq);
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(401);
      expect((err as HttpError).code).toBe("UNAUTHENTICATED");
    }
  });

  it("throws HttpError 401 for an expired/invalid token", () => {
    const mockReq = {
      headers: { authorization: "Bearer invalid.jwt.token" },
      id: "req-bad-token",
    } as unknown as import("fastify").FastifyRequest;

    expect(() => resolveContext(mockReq)).toThrow(HttpError);
    try {
      resolveContext(mockReq);
    } catch (err) {
      expect((err as HttpError).status).toBe(401);
    }
  });
});

// ─── requireRole ─────────────────────────────────────────────────────────────

describe("requireRole (Req 15.1 — RBAC gating)", () => {
  it("does not throw when actor has at least one required role", () => {
    const ctx = {
      tenantId: TENANT,
      actorId: ACTOR,
      actorType: "user" as const,
      roles: ["committee_secretary", "hr_officer"],
      correlationId: "corr-1",
    };

    expect(() => requireRole(ctx, ["committee_secretary"])).not.toThrow();
    expect(() => requireRole(ctx, ["super_admin", "hr_officer"])).not.toThrow();
  });

  it("throws HttpError 403 FORBIDDEN when actor lacks all required roles", () => {
    const ctx = {
      tenantId: TENANT,
      actorId: ACTOR,
      actorType: "user" as const,
      roles: ["employee"],
      correlationId: "corr-2",
    };

    expect(() => requireRole(ctx, ["super_admin", "finance_admin"])).toThrow(HttpError);
    try {
      requireRole(ctx, ["super_admin"]);
    } catch (err) {
      expect((err as HttpError).status).toBe(403);
      expect((err as HttpError).code).toBe("FORBIDDEN");
      expect((err as HttpError).message).toContain("super_admin");
    }
  });
});

// ─── httpError factory ───────────────────────────────────────────────────────

describe("httpError factory (error code → HttpError mapping)", () => {
  it("maps error codes to correct HTTP status from ERROR_CODES", () => {
    const err = httpError("MEETING_NOT_FOUND", "meeting xyz not found");
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("MEETING_NOT_FOUND");
    expect(err.message).toBe("meeting xyz not found");
  });

  it("defaults message to the code string when message is omitted", () => {
    const err = httpError("MEETING_QUORUM_NOT_MET");
    expect(err.message).toBe("MEETING_QUORUM_NOT_MET");
    expect(err.status).toBe(422);
  });

  it("carries optional details for structured context", () => {
    const err = httpError("MEETING_INVALID_TRANSITION", "cannot go draft→closed", {
      allowedTransitions: ["scheduled"],
    });
    expect(err.details).toEqual({ allowedTransitions: ["scheduled"] });
  });

  it("maps MEETING_UNAUTHORIZED_ACCESS to 404 (avoid leaking resource existence)", () => {
    const err = httpError("MEETING_UNAUTHORIZED_ACCESS");
    expect(err.status).toBe(404);
  });

  it("maps VC_PROVIDER_UNAVAILABLE to 503", () => {
    const err = httpError("VC_PROVIDER_UNAVAILABLE", "NIC VC down");
    expect(err.status).toBe(503);
  });

  it("maps MEETING_VERSION_CONFLICT to 409", () => {
    const err = httpError("MEETING_VERSION_CONFLICT", "concurrent update");
    expect(err.status).toBe(409);
  });
});

// ─── toErrorEnvelope ─────────────────────────────────────────────────────────

describe("toErrorEnvelope (standard error envelope serialisation)", () => {
  it("serialises HttpError into the standard envelope structure", () => {
    const err = new HttpError(422, "MEETING_QUORUM_NOT_MET", "quorum is 3, got 2", {
      required: 3,
      present: 2,
    });

    const { status, body } = toErrorEnvelope(err, "corr-envelope-1");
    expect(status).toBe(422);
    expect(body.error.code).toBe("MEETING_QUORUM_NOT_MET");
    expect(body.error.message).toBe("quorum is 3, got 2");
    expect(body.error.details).toEqual({ required: 3, present: 2 });
    expect(body.error.correlationId).toBe("corr-envelope-1");
  });

  it("omits details field when not provided", () => {
    const err = new HttpError(404, "MEETING_NOT_FOUND", "not found");
    const { body } = toErrorEnvelope(err, "corr-no-details");
    expect(body.error).not.toHaveProperty("details");
  });

  it("collapses unknown errors to generic 500 INTERNAL (never leaks internals)", () => {
    const pgError = new Error("relation meeting.meetings does not exist");
    const { status, body } = toErrorEnvelope(pgError, "corr-pg-error");
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("internal error");
    expect(body.error.correlationId).toBe("corr-pg-error");
    // Must NOT leak the original error message
    expect(body.error.message).not.toContain("relation");
  });

  it("collapses non-Error thrown values to 500 INTERNAL", () => {
    const { status, body } = toErrorEnvelope("string thrown", "corr-string");
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
  });
});

// ─── ERROR_CODES mapping completeness ────────────────────────────────────────

describe("ERROR_CODES (design contract compliance)", () => {
  it("maps all documented domain codes to valid HTTP status numbers", () => {
    const validStatuses = [400, 401, 403, 404, 409, 422, 500, 503];
    for (const [code, status] of Object.entries(ERROR_CODES)) {
      expect(validStatuses, `${code} maps to unexpected status ${status}`).toContain(status);
    }
  });

  it("includes the core cross-cutting codes", () => {
    expect(ERROR_CODES.UNAUTHENTICATED).toBe(401);
    expect(ERROR_CODES.FORBIDDEN).toBe(403);
    expect(ERROR_CODES.VALIDATION_FAILED).toBe(400);
    expect(ERROR_CODES.INTERNAL).toBe(500);
  });

  it("includes VC provider codes", () => {
    expect(ERROR_CODES.VC_PROVIDER_UNAVAILABLE).toBe(503);
    expect(ERROR_CODES.VC_SESSION_NOT_FOUND).toBe(404);
  });

  it("includes calendar/room codes", () => {
    expect(ERROR_CODES.ROOM_DOUBLE_BOOKED).toBe(409);
    expect(ERROR_CODES.CALENDAR_CONFLICT).toBe(409);
  });
});
