/**
 * Tests for the shared API envelope helpers used by the world-class-gap modules.
 *
 * These exercise the branches the route suites cannot reach: a raw ZodError
 * arriving at the handler, and the catch-all 500 path — which must NOT leak a
 * driver-level message to the client.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import {
  listEnvelope,
  singleEnvelope,
  parseOrThrow,
  registerEnvelopeErrorHandler,
} from "../src/shared/envelope.js";
import { HttpError } from "../src/shared/context.js";

interface ErrBody { error: { code: string; message: string; correlationId: string; details?: Record<string, string> } }

describe("listEnvelope / singleEnvelope", () => {
  it("wraps a list with its pagination meta", () => {
    expect(listEnvelope([1, 2], { page: 2, pageSize: 10, total: 42 }))
      .toEqual({ data: [1, 2], meta: { page: 2, pageSize: 10, total: 42 } });
  });

  it("wraps an empty list without collapsing the envelope", () => {
    expect(listEnvelope([], { page: 1, pageSize: 10, total: 0 }))
      .toEqual({ data: [], meta: { page: 1, pageSize: 10, total: 0 } });
  });

  it("wraps a single resource", () => {
    expect(singleEnvelope({ id: "x" })).toEqual({ data: { id: "x" } });
  });
});

describe("parseOrThrow", () => {
  const schema = z.object({ name: z.string().min(2), nested: z.object({ n: z.number() }) });

  it("returns the parsed value on success", () => {
    expect(parseOrThrow(schema, { name: "ok", nested: { n: 1 } })).toEqual({ name: "ok", nested: { n: 1 } });
  });

  it("applies schema defaults", () => {
    expect(parseOrThrow(z.object({ n: z.number().default(7) }), {})).toEqual({ n: 7 });
  });

  it("throws a 400 HttpError with per-field details", () => {
    try {
      parseOrThrow(schema, { name: "x", nested: { n: "no" } });
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      const e = err as HttpError;
      expect(e.status).toBe(400);
      expect(e.code).toBe("VALIDATION_FAILED");
      expect(e.details).toMatchObject({ name: expect.any(String), "nested.n": expect.any(String) });
    }
  });

  it("keys a root-level failure under '_' rather than an empty string", () => {
    try {
      parseOrThrow(z.string(), 42);
      throw new Error("expected a throw");
    } catch (err) {
      expect((err as HttpError).details).toHaveProperty("_");
    }
  });
});

describe("registerEnvelopeErrorHandler", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false, genReqId: () => "generated-req-id" });
    await app.register(async (scope) => {
      scope.get("/http-error", async () => {
        throw new HttpError(422, "BUSINESS_RULE", "cannot do that");
      });
      scope.get("/http-error-with-details", async () => {
        throw new HttpError(400, "VALIDATION_FAILED", "invalid request").withDetails({ field: "too short" });
      });
      scope.get("/zod-error", async () => {
        // A raw ZodError, not routed through parseOrThrow.
        throw new ZodError([
          { code: "custom", path: ["outer", "inner"], message: "nope" },
          { code: "custom", path: [], message: "root problem" },
        ]);
      });
      scope.get("/driver-error", async () => {
        // Stands in for a raw Postgres error escaping a repo call.
        throw new Error('relation "uploads.documents" does not exist');
      });
      scope.get("/client-error", async () => {
        const err = new Error("unsupported media type") as Error & { statusCode: number };
        err.statusCode = 415;
        throw err;
      });
      scope.get("/server-error-with-status", async () => {
        const err = new Error("upstream exploded") as Error & { statusCode: number };
        err.statusCode = 502;
        throw err;
      });
      registerEnvelopeErrorHandler(scope);
    });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it("maps an HttpError to its own status and code", async () => {
    const res = await app.inject({ method: "GET", url: "/http-error" });
    expect(res.statusCode).toBe(422);
    const body = res.json() as ErrBody;
    expect(body.error.code).toBe("BUSINESS_RULE");
    expect(body.error.message).toBe("cannot do that");
    expect(body.error).not.toHaveProperty("details");
  });

  it("includes details only when the HttpError carries them", async () => {
    const res = await app.inject({ method: "GET", url: "/http-error-with-details" });
    expect((res.json() as ErrBody).error.details).toEqual({ field: "too short" });
  });

  it("maps a raw ZodError to 400 with per-field details", async () => {
    const res = await app.inject({ method: "GET", url: "/zod-error" });
    expect(res.statusCode).toBe(400);
    const body = res.json() as ErrBody;
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details).toEqual({ "outer.inner": "nope", _: "root problem" });
  });

  it("returns 500 INTERNAL for an unexpected error and does NOT leak the driver message", async () => {
    const res = await app.inject({ method: "GET", url: "/driver-error" });
    expect(res.statusCode).toBe(500);
    const body = res.json() as ErrBody;
    expect(body.error).toMatchObject({ code: "INTERNAL", message: "internal error" });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("uploads.documents");
    expect(raw).not.toContain("does not exist");
  });

  it("honours a 4xx statusCode set by Fastify itself instead of masking it as 500", async () => {
    const res = await app.inject({ method: "GET", url: "/client-error" });
    expect(res.statusCode).toBe(415);
    expect((res.json() as ErrBody).error.code).toBe("BAD_REQUEST");
  });

  it("still reports a 5xx statusCode as INTERNAL", async () => {
    const res = await app.inject({ method: "GET", url: "/server-error-with-status" });
    expect(res.statusCode).toBe(500);
    const body = res.json() as ErrBody;
    expect(body.error.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("upstream exploded");
  });

  it("uses the x-correlation-id header when present", async () => {
    const res = await app.inject({
      method: "GET", url: "/http-error", headers: { "x-correlation-id": "abc-123" },
    });
    expect((res.json() as ErrBody).error.correlationId).toBe("abc-123");
  });

  it("falls back to the request id when no correlation header is sent", async () => {
    const res = await app.inject({ method: "GET", url: "/http-error" });
    expect((res.json() as ErrBody).error.correlationId).toBe("generated-req-id");
  });

  it("falls back to the request id when the correlation header is empty", async () => {
    const res = await app.inject({ method: "GET", url: "/http-error", headers: { "x-correlation-id": "" } });
    expect((res.json() as ErrBody).error.correlationId).toBe("generated-req-id");
  });
});
