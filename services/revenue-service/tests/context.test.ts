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

function mockRequest(user?: Record<string, unknown>, headers?: Record<string, string>) {
  return {
    user,
    headers: headers ?? {},
    id: "req-123",
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("context.ts — Shared Infrastructure", () => {
  describe("resolveContext", () => {
    it("returns valid RequestContext when JWT user is present", () => {
      const req = mockRequest({
        sub: "actor-1",
        tid: "tenant-1",
        roles: ["revenue_admin", "finance_admin"],
        sid: "session-42",
      });

      const ctx = resolveContext(req);

      expect(ctx.actorId).toBe("actor-1");
      expect(ctx.tenantId).toBe("tenant-1");
      expect(ctx.roles).toEqual(["revenue_admin", "finance_admin"]);
      expect(ctx.sessionId).toBe("session-42");
      expect(ctx.correlationId).toBe("req-123");
    });

    it("uses x-correlation-id header when present", () => {
      const req = mockRequest(
        { sub: "actor-1", tid: "tenant-1", roles: ["admin"], sid: "s1" },
        { "x-correlation-id": "corr-abc-123" },
      );

      const ctx = resolveContext(req);

      expect(ctx.correlationId).toBe("corr-abc-123");
    });

    it("defaults roles to empty array when user.roles is undefined", () => {
      const req = mockRequest({ sub: "actor-1", tid: "tenant-1", sid: "s1" });

      const ctx = resolveContext(req);

      expect(ctx.roles).toEqual([]);
    });

    it("defaults sessionId to empty string when user.sid is undefined", () => {
      const req = mockRequest({ sub: "actor-1", tid: "tenant-1", roles: ["admin"] });

      const ctx = resolveContext(req);

      expect(ctx.sessionId).toBe("");
    });

    it("throws HttpError 401 when no user found on request", () => {
      const req = mockRequest(undefined);

      expect(() => resolveContext(req)).toThrow(HttpError);
      try {
        resolveContext(req);
      } catch (err) {
        const httpErr = err as HttpError;
        expect(httpErr.status).toBe(401);
        expect(httpErr.code).toBe("UNAUTHENTICATED");
        expect(httpErr.message).toBe("missing authentication");
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
