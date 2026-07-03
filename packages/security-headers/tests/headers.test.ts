import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { registerSecurityHeaders } from "../src/index.js";

describe("@civitasone/security-headers", () => {
  it("sets all required security headers", async () => {
    const app = Fastify();
    await registerSecurityHeaders(app);
    app.get("/test", async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/test" });

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-xss-protection"]).toBe("0");
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=()");
    expect(res.headers["cache-control"]).toBe("no-store");

    await app.close();
  });

  it("respects custom HSTS max-age", async () => {
    const app = Fastify();
    await registerSecurityHeaders(app, { hstsMaxAge: 86400, hstsIncludeSubDomains: false });
    app.get("/test", async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/test" });
    expect(res.headers["strict-transport-security"]).toBe("max-age=86400");

    await app.close();
  });

  it("allows custom cache-control override", async () => {
    const app = Fastify();
    await registerSecurityHeaders(app, { cacheControl: "public, max-age=3600" });
    app.get("/cached", async () => ({ data: "cacheable" }));
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/cached" });
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");

    await app.close();
  });

  it("applies custom headers when provided", async () => {
    const app = Fastify();
    await registerSecurityHeaders(app, {
      customHeaders: { "X-Custom-Header": "test-value" },
    });
    app.get("/custom", async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/custom" });
    expect(res.headers["x-custom-header"]).toBe("test-value");
    // Standard headers should still be present
    expect(res.headers["x-content-type-options"]).toBe("nosniff");

    await app.close();
  });

  it("headers are set on error responses too", async () => {
    const app = Fastify();
    await registerSecurityHeaders(app);
    app.get("/error", async () => {
      throw new Error("Internal error");
    });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/error" });
    expect(res.statusCode).toBe(500);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");

    await app.close();
  });
});
