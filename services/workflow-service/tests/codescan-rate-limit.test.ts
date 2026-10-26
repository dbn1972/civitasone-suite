import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

/**
 * CodeQL js/missing-rate-limiting (#1000 #1001 #1002 #1003): workflow-service must register the shared
 * @civitasone/rate-limit plugin (300 req/min per actor, ops paths excluded), like hrms/audit/billing.
 */
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000a7";
const EXTERNAL_IP = "203.0.113.20";

const bearer = (actor: string) => ({
  authorization: `Bearer ${signToken({ sub: actor, tid: TENANT, roles: ["workflow_admin"], sid: "sess-rl" }, SECRET)}`,
});

describe("workflow-service rate limiting (authority routes)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); await sqlClient.end(); });

  it("a per-actor burst beyond 300/min gets 429 RATE_LIMITED with Retry-After; another actor is unaffected", async () => {
    const actorA = globalThis.crypto.randomUUID();
    const hit = (actor: string) =>
      app.inject({ method: "GET", url: "/v1/workflow/authority/limits", remoteAddress: EXTERNAL_IP, headers: bearer(actor) });
    const statuses: number[] = [];
    for (let i = 0; i < 303; i++) statuses.push((await hit(actorA)).statusCode);
    expect(statuses.slice(0, 300).every((s) => s !== 429)).toBe(true);
    const limited = await hit(actorA);
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.json()).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect((await hit(globalThis.crypto.randomUUID())).statusCode).not.toBe(429);
  });

  it("ops endpoints are never rate limited", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: "GET", url: "/health", remoteAddress: EXTERNAL_IP });
      expect(r.statusCode).not.toBe(429);
    }
  });
});
