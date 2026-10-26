import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

describe("workflow-service rate limiting", () => {
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

  // Each module registers its own encapsulated error handler, so the 429 mapping must hold on routes outside
  // the authority module too (a 500 INTERNAL with no Retry-After was returned here before the shared helper).
  it("a non-authority module route (GET /v1/workflow/instances) also returns 429 RATE_LIMITED with Retry-After", async () => {
    const actor = globalThis.crypto.randomUUID();
    const hit = () =>
      app.inject({ method: "GET", url: "/v1/workflow/instances", remoteAddress: EXTERNAL_IP, headers: bearer(actor) });
    const statuses: number[] = [];
    for (let i = 0; i < 300; i++) statuses.push((await hit()).statusCode);
    expect(statuses.every((s) => s !== 429 && s < 500)).toBe(true);
    const limited = await hit();
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(limited.json()).toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });

  it("every module error handler maps rate-limit rejections via replyIfRateLimited", () => {
    const modulesDir = fileURLToPath(new URL("../src/modules", import.meta.url));
    const missing: string[] = [];
    let handlers = 0;
    for (const mod of readdirSync(modulesDir)) {
      const file = join(modulesDir, mod, "routes.ts");
      if (!existsSync(file)) continue;
      const src = readFileSync(file, "utf8");
      if (!src.includes("setErrorHandler(")) continue;
      handlers++;
      if (!/setErrorHandler\(\(err, req, reply\) => \{\s*const rateLimited = replyIfRateLimited\(err, req, reply\);\s*if \(rateLimited\) return rateLimited;/.test(src)) missing.push(mod);
    }
    expect(handlers).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });

  it("ops endpoints are never rate limited", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({ method: "GET", url: "/health", remoteAddress: EXTERNAL_IP });
      expect(r.statusCode).not.toBe(429);
    }
  });
});
