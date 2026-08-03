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
    expect(res.json()).toMatchObject({
      driver: expect.any(String),
      healthy: expect.any(Boolean),
      mode: "bus-only",
      domainMutations: "n/a",
    });
  });

  it("exposes drivers catalogue with auth", async () => {
    const denied = await app.inject({ method: "GET", url: "/v1/queue/drivers" });
    expect(denied.statusCode).toBe(401);
    const res = await app.inject({
      method: "GET",
      url: "/v1/queue/drivers",
      headers: { "x-internal": "1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.supported).toEqual(expect.arrayContaining(["memory", "sqs", "rabbitmq"]));
  });

  it("exposes ops surface documenting F3/F4 N/A", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/queue/ops",
      headers: { "x-internal": "1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.role).toBe("platform_message_bus");
    expect(res.json().data.cqrs.f3).toMatch(/n\/a/i);
    expect(res.json().data.cqrs.f4).toMatch(/n\/a/i);
  });
});

