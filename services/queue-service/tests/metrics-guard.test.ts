import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

/**
 * 09-T2: /metrics must be guarded on every service. The guard lives centrally in
 * packages/observability (registerOpsRoutes), so buildApp() here exercises it.
 * METRICS_TOKEN is read per-request, so we toggle it around each case.
 * app.inject reports a loopback (127.0.0.1) source IP, i.e. an internal address.
 */
describe("queue-service /metrics guard (09-T2)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    delete process.env.METRICS_TOKEN;
  });

  it("rejects /metrics without the token when METRICS_TOKEN is set", async () => {
    process.env.METRICS_TOKEN = "secret-token";
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "FORBIDDEN", message: "metrics access denied" });
  });

  it("rejects /metrics with a wrong token when METRICS_TOKEN is set", async () => {
    process.env.METRICS_TOKEN = "secret-token";
    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { "x-metrics-token": "nope" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("allows /metrics with the correct token", async () => {
    process.env.METRICS_TOKEN = "secret-token";
    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { "x-metrics-token": "secret-token" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("service_up");
  });

  it("allows /metrics from an internal IP when no token is configured", async () => {
    // METRICS_TOKEN unset (afterEach) + loopback source IP from app.inject.
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("service_up");
  });
});
