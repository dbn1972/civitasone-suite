/**
 * CLOS3-S6-18: redisClientOptions() exposes the fail-fast ioredis options so
 * dedicated service clients do not fall back to the slow ioredis defaults.
 */
import { describe, it, expect } from "vitest";
import { redisClientOptions, REDIS_CLIENT_OPTIONS } from "../src/index.js";

describe("redisClientOptions", () => {
  it("defaults to the shared fail-fast options", () => {
    expect(REDIS_CLIENT_OPTIONS).toEqual({ maxRetriesPerRequest: 1, connectTimeout: 1500, commandTimeout: 1000 });
    expect(redisClientOptions()).toEqual({ maxRetriesPerRequest: 1, connectTimeout: 1500, commandTimeout: 1000 });
  });
  it("lets a caller override or drop a single option (e.g. a blocking consumer)", () => {
    expect(redisClientOptions({ commandTimeout: undefined })).toEqual({ maxRetriesPerRequest: 1, connectTimeout: 1500 });
    expect(redisClientOptions({ commandTimeout: 5000 }).commandTimeout).toBe(5000);
  });
  it("returns a fresh object each call (callers cannot mutate the shared defaults)", () => {
    const a = redisClientOptions(); a.commandTimeout = 1;
    expect(redisClientOptions().commandTimeout).toBe(1000);
    expect(REDIS_CLIENT_OPTIONS.commandTimeout).toBe(1000);
  });
});
