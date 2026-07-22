/**
 * shared/context.ts — HttpError, httpError, toErrorEnvelope, resolveContext, requireRole.
 *
 * Exercises the error mapping utilities and auth resolution helpers. No mocking
 * of the context module itself — tests the REAL functions for function coverage.
 */
import { describe, it, expect, vi } from "vitest";

// Mock @civitasone/auth and @civitasone/auth/context for the resolveContext / requireRole path
vi.mock("@civitasone/auth/context", () => {
  class AuthContextError extends Error {
    status: number;
    code: string;
    constructor(s: number, c: string, m: string) { super(m); this.status = s; this.code = c; }
  }
  return {
    resolveServiceContext: (req: { headers?: { authorization?: string } }) => {
      if (!req.headers?.authorization) throw new AuthContextError(401, "UNAUTHENTICATED", "missing token");
      return { tenantId: "t-1", actorId: "a-1", roles: ["registrar"], correlationId: "c-1", sessionId: "s" };
    },
    AuthContextError,
  };
});

vi.mock("@civitasone/auth", () => ({
  hasAnyRole: (ctx: { roles: string[] }, required: string[]) => required.some((r) => ctx.roles.includes(r)),
}));

describe("shared/context — HttpError", () => {
  it("HttpError carries status, code, message, details", async () => {
    const { HttpError } = await import("../src/shared/context.js");
    const err = new HttpError(409, "CNR_ALREADY_EXISTS", "CNR exists", { cnr: "X" });
    expect(err.status).toBe(409);
    expect(err.code).toBe("CNR_ALREADY_EXISTS");
    expect(err.message).toBe("CNR exists");
    expect(err.details).toEqual({ cnr: "X" });
    expect(err.name).toBe("HttpError");
  });

  it("HttpError works without details", async () => {
    const { HttpError } = await import("../src/shared/context.js");
    const err = new HttpError(404, "CASE_NOT_FOUND", "not found");
    expect(err.details).toBeUndefined();
  });
});

describe("shared/context — httpError helper", () => {
  it("derives status from ERROR_CODES map", async () => {
    const { httpError } = await import("../src/shared/context.js");
    const err = httpError("CASE_NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.code).toBe("CASE_NOT_FOUND");
  });

  it("uses custom message when provided", async () => {
    const { httpError } = await import("../src/shared/context.js");
    const err = httpError("CASE_INVALID_TRANSITION", "Cannot go from filed to disposed");
    expect(err.status).toBe(422);
    expect(err.message).toBe("Cannot go from filed to disposed");
  });

  it("includes details when provided", async () => {
    const { httpError } = await import("../src/shared/context.js");
    const err = httpError("CAUSELIST_SLOT_CONFLICT", "slot taken", { slot: 3 });
    expect(err.status).toBe(409);
    expect(err.details).toEqual({ slot: 3 });
  });

  it("falls back to code as message when no message provided", async () => {
    const { httpError } = await import("../src/shared/context.js");
    const err = httpError("INTERNAL");
    expect(err.message).toBe("INTERNAL");
  });
});

describe("shared/context — toErrorEnvelope", () => {
  it("maps HttpError to standard envelope", async () => {
    const { toErrorEnvelope, HttpError } = await import("../src/shared/context.js");
    const err = new HttpError(422, "CASE_INVALID_TRANSITION", "bad transition", { from: "filed", to: "closed" });
    const { status, body } = toErrorEnvelope(err, "corr-1");
    expect(status).toBe(422);
    expect(body.error.code).toBe("CASE_INVALID_TRANSITION");
    expect(body.error.message).toBe("bad transition");
    expect(body.error.details).toEqual({ from: "filed", to: "closed" });
    expect(body.error.correlationId).toBe("corr-1");
  });

  it("maps HttpError without details (no details key in output)", async () => {
    const { toErrorEnvelope, HttpError } = await import("../src/shared/context.js");
    const err = new HttpError(404, "NOT_FOUND", "gone");
    const { status, body } = toErrorEnvelope(err, "corr-2");
    expect(status).toBe(404);
    expect(body.error.details).toBeUndefined();
  });

  it("maps unknown errors to generic 500 INTERNAL", async () => {
    const { toErrorEnvelope } = await import("../src/shared/context.js");
    const { status, body } = toErrorEnvelope(new Error("pg crashed"), "corr-3");
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe("internal error");
  });

  it("maps non-Error unknowns to generic 500", async () => {
    const { toErrorEnvelope } = await import("../src/shared/context.js");
    const { status, body } = toErrorEnvelope("string error", "corr-4");
    expect(status).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
  });
});

describe("shared/context — resolveContext", () => {
  it("returns RequestContext for valid auth", async () => {
    const { resolveContext } = await import("../src/shared/context.js");
    const req = { headers: { authorization: "Bearer valid" } } as never;
    const ctx = resolveContext(req);
    expect(ctx.tenantId).toBe("t-1");
    expect(ctx.actorId).toBe("a-1");
  });

  it("throws HttpError on missing auth", async () => {
    const { resolveContext, HttpError } = await import("../src/shared/context.js");
    const req = { headers: {} } as never;
    expect(() => resolveContext(req)).toThrow(HttpError);
  });
});

describe("shared/context — requireRole", () => {
  it("passes when actor has a matching role", async () => {
    const { requireRole } = await import("../src/shared/context.js");
    const ctx = { tenantId: "t", actorId: "a", roles: ["registrar", "viewer"], correlationId: "c", sessionId: "s" };
    expect(() => requireRole(ctx, ["registrar"])).not.toThrow();
  });

  it("throws 403 when actor lacks required roles", async () => {
    const { requireRole, HttpError } = await import("../src/shared/context.js");
    const ctx = { tenantId: "t", actorId: "a", roles: ["employee"], correlationId: "c", sessionId: "s" };
    try {
      requireRole(ctx, ["court_admin", "super_admin"]);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as InstanceType<typeof HttpError>).status).toBe(403);
    }
  });
});

describe("shared/context — ERROR_CODES", () => {
  it("exports all expected error codes", async () => {
    const { ERROR_CODES } = await import("../src/shared/context.js");
    expect(ERROR_CODES.CASE_NOT_FOUND).toBe(404);
    expect(ERROR_CODES.UNAUTHENTICATED).toBe(401);
    expect(ERROR_CODES.FORBIDDEN).toBe(403);
    expect(ERROR_CODES.INTERNAL).toBe(500);
    expect(ERROR_CODES.CASE_VERSION_CONFLICT).toBe(409);
    expect(ERROR_CODES.HEARING_NOT_FOUND).toBe(404);
  });
});
