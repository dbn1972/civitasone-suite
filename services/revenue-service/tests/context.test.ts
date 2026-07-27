/**
 * Shared infrastructure tests — context.ts
 *
 * Covers: resolveContext, requireRole, HttpError
 *
 * _Requirements: Req 20 (Shared Infrastructure Test Coverage)_
 */
import { describe, it, expect } from "vitest";
import { resolveContext, requireRole, HttpError, type RequestContext } from "../src/shared/context.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a request the way the auth plugin actually decorates it.
 *
 * These tests previously set `req.user`, which the plugin NEVER sets — it
 * decorates `req.ctx` (packages/auth/src/plugin.ts). Asserting against `user`
 * meant the suite passed while every authenticated route in this service
 * returned 401 in production. The tenant id must also be a real UUID, because
 * resolveContext rejects a malformed one.
 */
const TENANT = "00000000-0000-0000-0000-000000000001";
const ACTOR = "aaaaaaaa-0000-4000-8000-000000000001";

function mockRequest(ctx?: Record<string, unknown>, headers?: Record<string, string>) {
  return {
    ctx,
    headers: headers ?? {},
    id: "req-123",
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("context.ts — Shared Infrastructure", () => {
  describe("resolveContext", () => {
    it("returns valid RequestContext when the auth plugin has set req.ctx", () => {
      const req = mockRequest({
        actorId: ACTOR,
        tenantId: TENANT,
        roles: ["revenue_admin", "finance_admin"],
        sessionId: "session-42",
        correlationId: "req-123",
      });

      const ctx = resolveContext(req);

      expect(ctx.actorId).toBe(ACTOR);
      expect(ctx.tenantId).toBe(TENANT);
      expect(ctx.roles).toEqual(["revenue_admin", "finance_admin"]);
      expect(ctx.sessionId).toBe("session-42");
      expect(ctx.correlationId).toBe("req-123");
    });

    it("uses x-correlation-id header when present", () => {
      const req = mockRequest(
        { actorId: ACTOR, tenantId: TENANT, roles: ["admin"], sessionId: "s1" },
        { "x-correlation-id": "corr-abc-123" },
      );

      const ctx = resolveContext(req);

      expect(ctx.correlationId).toBe("corr-abc-123");
    });

    it("passes through an absent roles claim rather than inventing one", () => {
      // The shared resolver does NOT default roles. That is fine because
      // requireRole coalesces to [] and therefore FAILS CLOSED with 403; the
      // previous local implementation defaulted here instead, which is what let
      // the two diverge. Asserted so the contract is explicit.
      const req = mockRequest({ actorId: ACTOR, tenantId: TENANT, sessionId: "s1" });

      const ctx = resolveContext(req);

      expect(ctx.roles).toBeUndefined();
      expect(() => requireRole(ctx, ["revenue_admin"])).toThrow(HttpError);
    });

    it("passes through an absent sessionId rather than inventing one", () => {
      const req = mockRequest({ actorId: ACTOR, tenantId: TENANT, roles: ["admin"] });

      const ctx = resolveContext(req);

      expect(ctx.sessionId).toBeUndefined();
    });

    it("rejects a malformed (non-UUID) tenant id", () => {
      // Guards the UUID_RE check: a service that accepts "tenant-1" cannot
      // enforce tenant isolation downstream.
      const req = mockRequest({ actorId: ACTOR, tenantId: "tenant-1", roles: ["admin"], sessionId: "s1" });
      expect(() => resolveContext(req)).toThrow(HttpError);
    });

    it("throws HttpError 401 when req.ctx is absent", () => {
      const req = mockRequest(undefined);

      expect(() => resolveContext(req)).toThrow(HttpError);
      try {
        resolveContext(req);
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(401);
        expect(httpErr.code).toBe("UNAUTHENTICATED");
        expect(httpErr.message).toBe("missing bearer token");
      }
    });
  });

  describe("requireRole", () => {
    const ctx: RequestContext = {
      actorId: "actor-1",
      tenantId: "tenant-1",
      roles: ["revenue_admin", "employee"],
      sessionId: "s1",
      correlationId: "c1",
    };

    it("passes when actor has at least one matching role", () => {
      expect(() => requireRole(ctx, ["revenue_admin", "super_admin"])).not.toThrow();
    });

    it("passes when actor matches any of the allowed roles", () => {
      expect(() => requireRole(ctx, ["finance_admin", "employee"])).not.toThrow();
    });

    it("throws HttpError 403 when actor lacks all required roles", () => {
      expect(() => requireRole(ctx, ["super_admin", "finance_admin"])).toThrow(HttpError);
      try {
        requireRole(ctx, ["super_admin", "finance_admin"]);
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(403);
        expect(httpErr.code).toBe("FORBIDDEN");
        expect(httpErr.message).toBe("insufficient role");
      }
    });

    it("throws HttpError 403 when actor has empty roles", () => {
      const emptyCtx: RequestContext = { ...ctx, roles: [] };
      expect(() => requireRole(emptyCtx, ["revenue_admin"])).toThrow(HttpError);
    });
  });

  describe("HttpError", () => {
    it("carries correct status, code, and message properties", () => {
      const err = new HttpError(422, "OVERPAYMENT", "amount exceeds balance");

      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(422);
      expect(err.code).toBe("OVERPAYMENT");
      expect(err.message).toBe("amount exceeds balance");
      expect(err.name).toBe("HttpError");
    });

    it("is throwable and catchable", () => {
      const fn = () => { throw new HttpError(500, "INTERNAL", "unexpected"); };
      expect(fn).toThrow(HttpError);
      expect(fn).toThrow("unexpected");
    });
  });
});
