import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctor = vi.hoisted(() => ({ count: 0, listeners: [] as string[] }));

vi.mock("ioredis", () => ({
  Redis: class FakeRedis {
    constructor(public url: string) {
      ctor.count += 1;
    }
    on(event: string) {
      ctor.listeners.push(event);
      return this;
    }
    async publish() {
      return 1;
    }
  },
}));

import {
  createNotificationPublisher,
  MemoryNotificationPublisher,
  setNotificationPublisherForTests,
} from "../src/adapters/pubsub.js";

describe("createNotificationPublisher redis singleton (CLOS3-S5-01)", () => {
  const saved = { d: process.env.NOTIFICATION_IN_APP_DRIVER, u: process.env.REDIS_URL };
  beforeEach(() => {
    ctor.count = 0;
    ctor.listeners.length = 0;
    setNotificationPublisherForTests(null);
    process.env.NOTIFICATION_IN_APP_DRIVER = "redis";
    process.env.REDIS_URL = "redis://singleton-test:6379";
  });
  afterEach(() => {
    setNotificationPublisherForTests(null);
    if (saved.d === undefined) delete process.env.NOTIFICATION_IN_APP_DRIVER;
    else process.env.NOTIFICATION_IN_APP_DRIVER = saved.d;
    if (saved.u === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = saved.u;
  });

  it("builds one Redis client for repeated calls and returns the same instance", () => {
    const a = createNotificationPublisher();
    const b = createNotificationPublisher();
    const c = createNotificationPublisher();
    expect(ctor.count).toBe(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("registers an error listener on the client", () => {
    createNotificationPublisher();
    expect(ctor.listeners).toContain("error");
  });

  it("rebuilds the client when REDIS_URL changes", () => {
    const a = createNotificationPublisher();
    process.env.REDIS_URL = "redis://other-host:6379";
    const b = createNotificationPublisher();
    expect(ctor.count).toBe(2);
    expect(b).not.toBe(a);
  });

  it("test override still wins and creates no client", () => {
    const mem = new MemoryNotificationPublisher();
    setNotificationPublisherForTests(mem);
    expect(createNotificationPublisher()).toBe(mem);
    expect(ctor.count).toBe(0);
  });
});
