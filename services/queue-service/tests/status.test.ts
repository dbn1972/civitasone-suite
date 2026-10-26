import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const AUTH = {
  authorization: `Bearer ${signToken({ sub: "ops-user", tid: "aaaaaaaa-0000-4000-8000-0000000000b2", roles: ["super_admin"], sid: "s-status" }, SECRET, 3600)}`,
};
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

  it("allows an authenticated status probe", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/queue/status",
      headers: AUTH,
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
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.supported).toEqual(expect.arrayContaining(["memory", "sqs", "rabbitmq"]));
  });

  it("exposes ops surface documenting F3/F4 N/A", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/queue/ops",
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.role).toBe("platform_message_bus");
    expect(res.json().data.cqrs.f3).toMatch(/n\/a/i);
    expect(res.json().data.cqrs.f4).toMatch(/n\/a/i);
  });
});

