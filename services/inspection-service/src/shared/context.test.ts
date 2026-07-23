import { describe, it, expect, vi } from "vitest";
import { HttpError, resolveContext, requireRole } from "./context.js";

// Mock @civitasone/auth and @civitasone/auth/context
vi.mock("@civitasone/auth/context", () => ({
  resolveServiceContext: vi.fn(),
  AuthContextError: class AuthContextError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  },
}));

vi.mock("@civitasone/auth", () => ({
  hasAnyRole: vi.fn(),
}));

import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { hasAnyRole } from "@civitasone/auth";

const mockResolveServiceContext = resolveServiceContext as ReturnType<typeof vi.fn>;
const mockHasAnyRole = hasAnyRole as ReturnType<typeof vi.fn>;

describe("shared/context", () => {
  describe("HttpError", () => {
    it("captures status, code, and message", () => {
      const err = new HttpError(422, "INVALID_TRANSITION", "cannot move to active");
      expect(err.status).toBe(422);
      expect(err.code).toBe("INVALID_TRANSITION");
      expect(err.message).toBe("cannot move to active");
      expect(err).toBeInstanceOf(Error);
    });

    it("optionally includes details", () => {
      const err = new HttpError(400, "VALIDATION_ERROR", "bad input", { field: "name" });
      expect(err.details).toEqual({ field: "name" });
    });
  });

  describe("resolveContext", () => {
    it("returns context when tenantId is a valid UUID", () => {
      const ctx = {
        tenantId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        actorId: "11111111-2222-3333-4444-555555555555",
        actorType: "user" as const,
        roles: ["inspector"],
        correlationId: "corr-1",
      };
      mockResolveServiceContext.mockReturnValue(ctx);

      const result = resolveContext({} as any);
      expect(result).toEqual(ctx);
    });

    it("throws 401 when tenantId is missing", () => {
      mockResolveServiceContext.mockReturnValue({
        tenantId: "",
        actorId: "11111111-2222-3333-4444-555555555555",
        actorType: "user",
        roles: [],
        correlationId: "corr-1",
      });

      expect(() => resolveContext({} as any)).toThrow(HttpError);
      try {
        resolveContext({} as any);
      } catch (err) {
        expect((err as HttpError).status).toBe(401);
        expect((err as HttpError).code).toBe("UNAUTHENTICATED");
      }
    });

    it("throws 401 when tenantId is not a valid UUID", () => {
      mockResolveServiceContext.mockReturnValue({
        tenantId: "not-a-uuid",
        actorId: "11111111-2222-3333-4444-555555555555",
        actorType: "user",
        roles: [],
        correlationId: "corr-1",
      });

      expect(() => resolveContext({} as any)).toThrow(HttpError);
    });

    it("maps AuthContextError to HttpError", () => {
      const authErr = new AuthContextError(401, "UNAUTHENTICATED", "missing bearer token");
      mockResolveServiceContext.mockImplementation(() => { throw authErr; });

      expect(() => resolveContext({} as any)).toThrow(HttpError);
      try {
        resolveContext({} as any);
      } catch (err) {
        expect((err as HttpError).status).toBe(401);
        expect((err as HttpError).code).toBe("UNAUTHENTICATED");
        expect((err as HttpError).message).toBe("missing bearer token");
      }
    });

    it("rethrows unexpected errors as-is", () => {
      mockResolveServiceContext.mockImplementation(() => { throw new TypeError("unexpected"); });

      expect(() => resolveContext({} as any)).toThrow(TypeError);
    });
  });

  describe("requireRole", () => {
    it("does not throw when the user has a matching role", () => {
      mockHasAnyRole.mockReturnValue(true);
      const ctx = {
        tenantId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        actorId: "11111111-2222-3333-4444-555555555555",
        actorType: "user" as const,
        roles: ["inspector"],
        correlationId: "corr-1",
      };
      expect(() => requireRole(ctx, ["inspector", "inspection_admin"])).not.toThrow();
    });

    it("throws 403 when the user does not have any of the required roles", () => {
      mockHasAnyRole.mockReturnValue(false);
      const ctx = {
        tenantId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        actorId: "11111111-2222-3333-4444-555555555555",
        actorType: "user" as const,
        roles: ["employee"],
        correlationId: "corr-1",
      };

      expect(() => requireRole(ctx, ["inspector", "inspection_admin"])).toThrow(HttpError);
      try {
        requireRole(ctx, ["inspector", "inspection_admin"]);
      } catch (err) {
        expect((err as HttpError).status).toBe(403);
        expect((err as HttpError).code).toBe("FORBIDDEN");
        expect((err as HttpError).message).toContain("inspector");
        expect((err as HttpError).message).toContain("inspection_admin");
      }
    });
  });
});
