/**
 * UAT FQ9 boot-order: after a host reboot the gateway started before Redis and hung — buildApp()
 * awaited an unbounded `redis.connect()` (rate-limit store + quota store) before listen(). Redis that
 * is not up yet must delay boot by at most GATEWAY_REDIS_CONNECT_TIMEOUT_MS, and the quota store must
 * switch to Redis once it becomes ready.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const clients: Array<{ emit(e: string): void; evalCalls: number; disconnected: boolean }> = [];
  class HangingRedis {
    handlers = new Map<string, Array<() => void>>();
    evalCalls = 0;
    disconnected = false;
    constructor() { clients.push(this); }
    connect(): Promise<void> { return new Promise(() => undefined); } // Redis not up: never settles
    on(e: string, fn: () => void) { this.handlers.set(e, [...(this.handlers.get(e) ?? []), fn]); return this; }
    emit(e: string) { for (const fn of this.handlers.get(e) ?? []) fn(); }
    disconnect() { this.disconnected = true; }
    defineCommand() { /* @fastify/rate-limit probe */ }
    async get() { return null; }
    async set() { return "OK"; }
    async eval() { this.evalCalls++; return 42; }
  }
  return { clients, HangingRedis };
});

vi.mock("ioredis", () => ({ default: fake.HangingRedis, Redis: fake.HangingRedis }));

afterEach(() => {
  vi.unstubAllEnvs();
  fake.clients.length = 0;
});

describe("gateway does not block boot on Redis", () => {
  it("createRedisQuotaStore returns within the bound, counts in memory, then uses Redis once ready", async () => {
    const { createRedisQuotaStore } = await import("../src/quota-store.js");
    const t0 = Date.now();
    const store = await createRedisQuotaStore("redis://127.0.0.1:6381");
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(await store.incr("k", 60)).toBe(1); // in-memory fallback
    expect(await store.incr("k", 60)).toBe(2);
    const client = fake.clients[0]!;
    expect(client.evalCalls).toBe(0);
    client.emit("ready");
    expect(await store.incr("k", 60)).toBe(42); // Redis path
    expect(client.evalCalls).toBe(1);
    client.emit("close");
    expect(await store.incr("k", 60)).toBe(3); // back to memory while reconnecting
  }, 20_000);

  it("connectWithin resolves false at the timeout instead of hanging", async () => {
    const { connectWithin } = await import("../src/redis-connect.js");
    const t0 = Date.now();
    expect(await connectWithin({ connect: () => new Promise(() => undefined) }, 200)).toBe(false);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(await connectWithin({ connect: async () => undefined }, 200)).toBe(true);
    expect(await connectWithin({ connect: async () => { throw new Error("ECONNREFUSED"); } }, 200)).toBe(false);
  });

  it("buildApp completes with REDIS_URL pointing at a Redis that is not up", async () => {
    vi.stubEnv("REDIS_URL", "redis://127.0.0.1:6381");
    vi.stubEnv("GATEWAY_REDIS_CONNECT_TIMEOUT_MS", "300");
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const t0 = Date.now();
    const app = await buildApp();
    expect(Date.now() - t0).toBeLessThan(15_000);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    // The rate-limit client that could not connect is shut down, not left retrying forever.
    expect(fake.clients.some((c) => c.disconnected)).toBe(true);
    await app.close();
  }, 30_000);
});
