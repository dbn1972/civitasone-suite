/**
 * Production safety: memory queue must never start in NODE_ENV=production.
 */
import { describe, it, expect, afterEach } from "vitest";

describe("Queue production guard", () => {
  const prevEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...prevEnv };
  });

  it("throws when QUEUE_DRIVER=memory in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.QUEUE_DRIVER = "memory";
    const { createQueue } = await import("../../services/queue-service/src/bus.js");
    expect(() => createQueue()).toThrow(/forbidden in production/i);
  });

  it("allows memory queue in test environment", async () => {
    process.env.NODE_ENV = "test";
    process.env.QUEUE_DRIVER = "memory";
    const { createQueue } = await import("../../services/queue-service/src/bus.js");
    expect(() => createQueue()).not.toThrow();
  });

  // QUE-3 (05-T3): driver resolution is fail-closed outside tests.
  it("throws when QUEUE_DRIVER is unset outside a test env", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.QUEUE_DRIVER;
    delete process.env.QUEUE_ADAPTER;
    delete process.env.VITEST; // simulate a real non-test process
    const { resolveQueueDriver } = await import("../../services/queue-service/src/bus.js");
    expect(() => resolveQueueDriver()).toThrow(/QUEUE_DRIVER is required/i);
  });

  it("throws on an unknown/typo QUEUE_DRIVER (no silent fallback to memory)", async () => {
    process.env.NODE_ENV = "production";
    process.env.QUEUE_DRIVER = "rabitqm";
    const { resolveQueueDriver } = await import("../../services/queue-service/src/bus.js");
    expect(() => resolveQueueDriver()).toThrow(/unknown QUEUE_DRIVER/i);
  });
});
