/**
 * GAP-TENANT-ADMIN-PLATFORM-CONFIG-03: GET /v1/admin/platform-config must never
 * return a credential embedded in REDIS_URL / AWS_ENDPOINT_URL, including the
 * shapes the old Redis-only regex missed (userinfo without a colon), and a
 * non-platform caller gets 403.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { sqlClient } from "../src/shared/db.js";
import { redactEndpoint } from "../src/modules/platform-config/routes.js";

const { buildApp } = await import("../src/app.js");

const SECRET = process.env.JWT_SECRET as string;
const TID = randomUUID();
const bearer = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: randomUUID(), roles, tid: TID } as never, SECRET)}` });
// Built at runtime so no credential-shaped literal sits in the source.
const PW = `p${globalThis.crypto.randomUUID().replace(/-/g, "")}`;

describe("redactEndpoint", () => {
  it.each([
    [`redis://default:${PW}@cache.internal:6380/0`, "redis://cache.internal:6380"],
    [`redis://${PW}@cache.internal:6380`, "redis://cache.internal:6380"],
    [`rediss://:${PW}@cache.internal`, "rediss://cache.internal"],
    [`https://AKIA:${PW}@s3.example.test/bucket?X-Amz-Signature=${PW}`, "https://s3.example.test"],
    ["http://localhost:4566", "http://localhost:4566"],
    [`cache.internal:6379`, "cache.internal:6379"],
  ])("%s -> %s", (input, expected) => {
    const out = redactEndpoint(input);
    expect(out).toBe(expected);
    expect(out).not.toContain(PW);
  });
});

describe("GET /v1/admin/platform-config", () => {
  let app: FastifyInstance;
  const saved = { r: process.env.REDIS_URL, a: process.env.AWS_ENDPOINT_URL };
  beforeAll(async () => {
    process.env.REDIS_URL = `redis://${PW}@cache.internal:6380`;
    process.env.AWS_ENDPOINT_URL = `https://AKIA:${PW}@queue.example.test/path?sig=${PW}`;
    app = await buildApp();
  });
  afterAll(async () => {
    if (saved.r === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = saved.r;
    if (saved.a === undefined) delete process.env.AWS_ENDPOINT_URL; else process.env.AWS_ENDPOINT_URL = saved.a;
    await app.close();
    await sqlClient.end();
  });

  it("returns redacted endpoints and the secret appears nowhere in the body", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/admin/platform-config", headers: bearer(["platform_admin"]) });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(PW);
    const infra = (r.json() as { infrastructure: { redis: { url: string }; queue: { endpoint: string }; storage: { endpoint: string } } }).infrastructure;
    expect(infra.redis.url).toBe("redis://cache.internal:6380");
    expect(infra.queue.endpoint).toBe("https://queue.example.test");
    expect(infra.storage.endpoint).toBe("https://queue.example.test");
  });

  it("a tenant_admin gets 403", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/admin/platform-config", headers: bearer(["tenant_admin"]) });
    expect(r.statusCode).toBe(403);
  });
});
