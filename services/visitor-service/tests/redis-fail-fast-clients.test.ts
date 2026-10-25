/**
 * CLOS3-S6-18: visitor-service Redis clients must be created with the shared
 * fail-fast options (not a bare `new Redis(url)`), and device rate limiting must
 * degrade to its in-memory window on a Redis error rather than stalling/throwing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctor = vi.hoisted(() => vi.fn());
const evalMock = vi.hoisted(() => vi.fn());
vi.mock("ioredis", () => ({
  Redis: class {
    constructor(...args: unknown[]) { ctor(...args); }
    eval = evalMock;
    disconnect() {}
  },
}));

import { checkRateLimit, resetDeviceAuthForTests } from "../src/modules/device-registry/device-auth.js";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("visitor-service Redis clients are fail-fast (CLOS3-S6-18)", () => {
  it("no source file constructs a bare `new Redis(url)`", () => {
    const offenders: string[] = [];
    for (const f of walk(join(__dirname, "../src"))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/new Redis\(([^)]*)\)/g)) {
        if (!m[1]!.includes("redisClientOptions(")) offenders.push(`${f}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  describe("device-auth checkRateLimit", () => {
    const saved = { url: process.env.REDIS_URL, driver: process.env.CACHE_DRIVER };
    beforeEach(() => {
      resetDeviceAuthForTests();
      ctor.mockClear(); evalMock.mockReset();
      process.env.REDIS_URL = "redis://127.0.0.1:6399";
      process.env.CACHE_DRIVER = "redis";
    });
    afterEach(() => {
      resetDeviceAuthForTests();
      if (saved.url === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = saved.url;
      if (saved.driver === undefined) delete process.env.CACHE_DRIVER; else process.env.CACHE_DRIVER = saved.driver;
    });

    it("constructs its client with bounded timeouts and retries", async () => {
      evalMock.mockResolvedValue(1);
      await checkRateLimit("d1", "t1", "kiosk");
      expect(ctor).toHaveBeenCalledTimes(1);
      expect(ctor.mock.calls[0]![1]).toMatchObject({ maxRetriesPerRequest: 1, connectTimeout: 1500, commandTimeout: 1000 });
    });

    it("on a Redis error falls back to the in-memory window and still enforces the limit", async () => {
      evalMock.mockRejectedValue(new Error("Command timed out"));
      for (let i = 0; i < 60; i++) expect(await checkRateLimit("d1", "t1", "kiosk")).toBe(true);
      expect(await checkRateLimit("d1", "t1", "kiosk")).toBe(false);
    });
  });
});
