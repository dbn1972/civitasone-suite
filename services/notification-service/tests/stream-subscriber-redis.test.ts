/**
 * RedisStreamSubscriber must release its dedicated connection on failure paths (CLOS3-S5-16).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const R = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  subscribe: vi.fn(async () => 1),
  unsubscribe: vi.fn(async () => 1),
  disconnect: vi.fn(() => undefined),
}));

vi.mock("ioredis", () => ({
  Redis: class FakeRedis {
    on() { return this; }
    connect() { return R.connect(); }
    subscribe() { return R.subscribe(); }
    unsubscribe() { return R.unsubscribe(); }
    disconnect() { return R.disconnect(); }
  },
}));

import { createStreamSubscriber } from "../src/modules/stream/subscriber.js";

describe("RedisStreamSubscriber connection cleanup", () => {
  const saved = { d: process.env.NOTIFICATION_IN_APP_DRIVER, u: process.env.REDIS_URL };
  beforeEach(() => {
    vi.clearAllMocks();
    R.connect.mockResolvedValue(undefined);
    R.subscribe.mockResolvedValue(1);
    R.unsubscribe.mockResolvedValue(1);
    process.env.NOTIFICATION_IN_APP_DRIVER = "redis";
    process.env.REDIS_URL = "redis://x";
  });
  afterEach(() => {
    if (saved.d === undefined) delete process.env.NOTIFICATION_IN_APP_DRIVER;
    else process.env.NOTIFICATION_IN_APP_DRIVER = saved.d;
    if (saved.u === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = saved.u;
  });

  it("disconnects and rethrows when connect() fails", async () => {
    R.connect.mockRejectedValueOnce(new Error("down"));
    await expect(createStreamSubscriber("c", () => undefined)).rejects.toThrow("down");
    expect(R.disconnect).toHaveBeenCalledTimes(1);
  });

  it("disconnects and rethrows when subscribe() fails", async () => {
    R.subscribe.mockRejectedValueOnce(new Error("rejected"));
    await expect(createStreamSubscriber("c", () => undefined)).rejects.toThrow("rejected");
    expect(R.disconnect).toHaveBeenCalledTimes(1);
  });

  it("does not disconnect on a successful connect, and disconnects once on unsubscribe", async () => {
    const sub = await createStreamSubscriber("c", () => undefined);
    expect(R.disconnect).not.toHaveBeenCalled();
    await sub.unsubscribe();
    expect(R.disconnect).toHaveBeenCalledTimes(1);
  });

  it("still disconnects, without throwing, when unsubscribe() rejects", async () => {
    const sub = await createStreamSubscriber("c", () => undefined);
    R.unsubscribe.mockRejectedValueOnce(new Error("boom"));
    await expect(sub.unsubscribe()).resolves.toBeUndefined();
    expect(R.disconnect).toHaveBeenCalledTimes(1);
  });
});
