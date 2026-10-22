/**
 * CLOS-S6-08: unit coverage for the shared Fastify error envelope
 * (createFastifyErrorHandler / isHttpError) used by every domain service via
 * registerSchemaErrorHandler. Pins established behaviour; no source change.
 */
import { describe, it, expect, vi } from "vitest";
import { z, ZodError } from "zod";
import { createFastifyErrorHandler, isHttpError, type HttpErrorLike } from "../src/http.js";
import { registerSchemaErrorHandler } from "../src/plugin.js";

function harness(headers: Record<string, unknown> = {}, id = "req-1") {
  const send = vi.fn();
  const code = vi.fn(() => ({ send }));
  const error = vi.fn();
  const req = { id, headers, log: { error } };
  return { req, reply: { code }, code, send, error };
}

describe("createFastifyErrorHandler", () => {
  it("maps a real ZodError to 400 VALIDATION_FAILED with dotted fieldErrors", () => {
    const parsed = z.object({ a: z.object({ b: z.string() }) }).safeParse({ a: { b: 1 } });
    expect(parsed.success).toBe(false);
    const h = harness();
    createFastifyErrorHandler()((parsed as { error: ZodError }).error, h.req, h.reply);
    expect(h.code).toHaveBeenCalledWith(400);
    const body = h.send.mock.calls[0][0];
    expect(body).toMatchObject({ code: "VALIDATION_FAILED", message: "invalid request", retryable: false, correlationId: "req-1" });
    expect(body.fieldErrors).toEqual([{ field: "a.b", message: expect.any(String) }]);
    expect(h.error).not.toHaveBeenCalled();
  });

  it("maps a duck-typed (cross-realm) ZodError the same way", () => {
    const h = harness();
    const fake = { name: "ZodError", issues: [{ path: ["x", 0], message: "bad" }] };
    createFastifyErrorHandler()(fake, h.req, h.reply);
    expect(h.code).toHaveBeenCalledWith(400);
    expect(h.send.mock.calls[0][0].fieldErrors).toEqual([{ field: "x.0", message: "bad" }]);
  });

  it("does not treat name=ZodError without an issues array as a Zod error", () => {
    const h = harness();
    createFastifyErrorHandler()({ name: "ZodError" }, h.req, h.reply);
    expect(h.code).toHaveBeenCalledWith(500);
  });

  it("maps a SyntaxError carrying statusCode to 400 MALFORMED_BODY", () => {
    const h = harness();
    const err = Object.assign(new SyntaxError("Unexpected token"), { statusCode: 400 });
    createFastifyErrorHandler()(err, h.req, h.reply);
    expect(h.code).toHaveBeenCalledWith(400);
    expect(h.send.mock.calls[0][0]).toMatchObject({ code: "MALFORMED_BODY", retryable: false });
    expect(JSON.stringify(h.send.mock.calls[0][0])).not.toContain("Unexpected token");
  });

  it("a SyntaxError without statusCode falls through to the 500 path", () => {
    const h = harness();
    createFastifyErrorHandler()(new SyntaxError("internal parse bug"), h.req, h.reply);
    expect(h.code).toHaveBeenCalledWith(500);
    expect(h.error).toHaveBeenCalledTimes(1);
  });

  it("uses getHttpError result for status, code and message", () => {
    const h = harness();
    const http: HttpErrorLike = { status: 403, code: "FORBIDDEN", message: "nope" };
    createFastifyErrorHandler(() => http)(new Error("x"), h.req, h.reply);
    expect(h.code).toHaveBeenCalledWith(403);
    expect(h.send.mock.calls[0][0]).toEqual({ code: "FORBIDDEN", message: "nope", correlationId: "req-1", retryable: false });
    expect(h.error).not.toHaveBeenCalled();
  });

  it("unknown error with no getHttpError -> 500 INTERNAL, retryable, logged, message not leaked", () => {
    const h = harness();
    const err = new Error("secret db detail");
    createFastifyErrorHandler()(err, h.req, h.reply);
    expect(h.code).toHaveBeenCalledWith(500);
    expect(h.send.mock.calls[0][0]).toEqual({ code: "INTERNAL", message: "internal error", correlationId: "req-1", retryable: true });
    expect(h.error).toHaveBeenCalledWith({ err }, "unhandled error");
  });

  it("falls to 500 when getHttpError returns null", () => {
    const h = harness();
    createFastifyErrorHandler(() => null)(new Error("x"), h.req, h.reply);
    expect(h.code).toHaveBeenCalledWith(500);
  });

  it("correlationId comes from x-correlation-id, else req.id", () => {
    const a = harness({ "x-correlation-id": "corr-9" });
    createFastifyErrorHandler()(new Error("x"), a.req, a.reply);
    expect(a.send.mock.calls[0][0].correlationId).toBe("corr-9");
    const b = harness({}, "fallback-id");
    createFastifyErrorHandler()(new Error("x"), b.req, b.reply);
    expect(b.send.mock.calls[0][0].correlationId).toBe("fallback-id");
  });
});

describe("isHttpError", () => {
  it("is true for {status, code}", () => {
    expect(isHttpError({ status: 404, code: "NOT_FOUND" })).toBe(true);
  });

  it("normalises {statusCode} (rate-limit) to status + RATE_LIMITED, mutating the input", () => {
    const err: Record<string, unknown> = { statusCode: 429 };
    expect(isHttpError(err)).toBe(true);
    expect(err.status).toBe(429);
    expect(err.code).toBe("RATE_LIMITED");
  });

  it("keeps an existing code when normalising statusCode", () => {
    const err: Record<string, unknown> = { statusCode: 413, code: "FST_ERR_CTP_BODY_TOO_LARGE" };
    expect(isHttpError(err)).toBe(true);
    expect(err.status).toBe(413);
    expect(err.code).toBe("FST_ERR_CTP_BODY_TOO_LARGE");
  });

  it("is false for null, strings, undefined and objects without status", () => {
    expect(isHttpError(null)).toBe(false);
    expect(isHttpError(undefined)).toBe(false);
    expect(isHttpError("boom")).toBe(false);
    expect(isHttpError({ message: "x" })).toBe(false);
    expect(isHttpError({ code: "X" })).toBe(false);
  });
});

describe("registerSchemaErrorHandler", () => {
  class MyHttpError extends Error {
    constructor(public status: number, public code: string, message: string) { super(message); }
  }

  function register(cls?: typeof MyHttpError) {
    let handler!: ReturnType<typeof createFastifyErrorHandler>;
    registerSchemaErrorHandler({ setErrorHandler: (h) => { handler = h; } }, cls);
    return handler;
  }

  it("maps instances of the supplied HttpError class", () => {
    const h = harness();
    register(MyHttpError)(new MyHttpError(409, "CONFLICT", "dup"), h.req, h.reply);
    expect(h.code).toHaveBeenCalledWith(409);
    expect(h.send.mock.calls[0][0]).toMatchObject({ code: "CONFLICT", message: "dup" });
  });

  it("maps a rate-limit style {statusCode} error to 429 even without a class", () => {
    const h = harness();
    register()(Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 }), h.req, h.reply);
    expect(h.code).toHaveBeenCalledWith(429);
    expect(h.send.mock.calls[0][0].code).toBe("RATE_LIMITED");
  });

  it("falls back to 500 for unknown errors", () => {
    const h = harness();
    register(MyHttpError)(new Error("x"), h.req, h.reply);
    expect(h.code).toHaveBeenCalledWith(500);
  });
});
