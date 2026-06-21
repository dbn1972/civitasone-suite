import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app.js";
import type { FastifyInstance } from "fastify";

describe("queue-service status", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects unauthenticated status requests", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/queue/status" });
    expect(res.statusCode).toBe(401);
  });

  it("allows internal status probe", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/queue/status",
      headers: { "x-internal": "1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ driver: expect.any(String), healthy: expect.any(Boolean) });
  });
});
