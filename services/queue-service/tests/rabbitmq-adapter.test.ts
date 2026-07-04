/**
 * RabbitMQ adapter — unit tests.
 *
 * Tests the adapter's interface compliance without requiring a running RabbitMQ.
 * Uses QUEUE_DRIVER=memory for the bus.ts factory test and verifies the class
 * shape and error handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createQueue, resolveQueueDriver } from "../src/bus.js";
import type { QueueDriver } from "../src/bus.js";

// ─────────────────────────────────────────────────────────────────────────────
// resolveQueueDriver — now supports rabbitmq
// ─────────────────────────────────────────────────────────────────────────────
describe("resolveQueueDriver", () => {
  const origDriver = process.env.QUEUE_DRIVER;
  const origAdapter = process.env.QUEUE_ADAPTER;
  const origEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (origDriver === undefined) delete process.env.QUEUE_DRIVER;
    else process.env.QUEUE_DRIVER = origDriver;
    if (origAdapter === undefined) delete process.env.QUEUE_ADAPTER;
    else process.env.QUEUE_ADAPTER = origAdapter;
    if (origEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origEnv;
  });

  it("resolves sqs", () => {
    process.env.QUEUE_DRIVER = "sqs";
    expect(resolveQueueDriver()).toBe("sqs");
  });

  it("resolves rabbitmq", () => {
    process.env.QUEUE_DRIVER = "rabbitmq";
    expect(resolveQueueDriver()).toBe("rabbitmq");
  });

  it("resolves memory", () => {
    process.env.QUEUE_DRIVER = "memory";
    expect(resolveQueueDriver()).toBe("memory");
  });

  it("defaults to memory in test env when unset", () => {
    delete process.env.QUEUE_DRIVER;
    delete process.env.QUEUE_ADAPTER;
    process.env.NODE_ENV = "test";
    expect(resolveQueueDriver()).toBe("memory");
  });

  it("throws on unknown driver", () => {
    process.env.QUEUE_DRIVER = "kafka";
    expect(() => resolveQueueDriver()).toThrow(/unknown QUEUE_DRIVER/);
  });

  it("throws when unset in non-test env", () => {
    delete process.env.QUEUE_DRIVER;
    delete process.env.QUEUE_ADAPTER;
    delete process.env.VITEST;
    process.env.NODE_ENV = "production";
    expect(() => resolveQueueDriver()).toThrow(/QUEUE_DRIVER is required/);
    // restore for next tests
    process.env.NODE_ENV = "test";
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createQueue — factory validation
// ─────────────────────────────────────────────────────────────────────────────
describe("createQueue factory", () => {
  const origDriver = process.env.QUEUE_DRIVER;
  const origEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (origDriver === undefined) delete process.env.QUEUE_DRIVER;
    else process.env.QUEUE_DRIVER = origDriver;
    if (origEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = origEnv;
  });

  it("creates MemoryQueue for memory driver", () => {
    process.env.QUEUE_DRIVER = "memory";
    process.env.NODE_ENV = "test";
    const q = createQueue();
    expect(q).toBeDefined();
    expect(typeof q.publish).toBe("function");
    expect(typeof q.subscribe).toBe("function");
    expect(typeof q.start).toBe("function");
    expect(typeof q.stop).toBe("function");
  });

  it("rejects memory driver in production", () => {
    process.env.QUEUE_DRIVER = "memory";
    process.env.NODE_ENV = "production";
    expect(() => createQueue()).toThrow(/forbidden in production/);
  });

  it("creates SqsQueue for sqs driver", () => {
    process.env.QUEUE_DRIVER = "sqs";
    process.env.NODE_ENV = "development";
    const q = createQueue();
    expect(q).toBeDefined();
    expect(typeof q.publish).toBe("function");
  });

  it("creates RabbitMqQueue for rabbitmq driver", () => {
    process.env.QUEUE_DRIVER = "rabbitmq";
    process.env.NODE_ENV = "development";
    const q = createQueue();
    expect(q).toBeDefined();
    expect(typeof q.publish).toBe("function");
    expect(typeof q.subscribe).toBe("function");
    expect(typeof q.start).toBe("function");
    expect(typeof q.stop).toBe("function");
    expect(typeof q.healthCheck).toBe("function");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RabbitMqQueue — interface compliance (no live RabbitMQ needed)
// ─────────────────────────────────────────────────────────────────────────────
describe("RabbitMqQueue interface", () => {
  it("can subscribe handlers before start", () => {
    process.env.QUEUE_DRIVER = "rabbitmq";
    const q = createQueue();
    // subscribe is synchronous — should not throw
    q.subscribe("test.topic", async () => {});
    q.subscribe("test.topic.two", async () => {});
  });

  it("healthCheck returns false when RabbitMQ is not running", async () => {
    process.env.QUEUE_DRIVER = "rabbitmq";
    process.env.RABBITMQ_URL = "amqp://localhost:59999"; // non-existent port
    const q = createQueue();
    const health = await q.healthCheck();
    expect(health.healthy).toBe(false);
  });

  it("stop does not throw when not started", async () => {
    process.env.QUEUE_DRIVER = "rabbitmq";
    const q = createQueue();
    await expect(q.stop()).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MemoryQueue — basic publish/subscribe round-trip
// ─────────────────────────────────────────────────────────────────────────────
describe("MemoryQueue round-trip", () => {
  it("delivers a message to subscriber", async () => {
    process.env.QUEUE_DRIVER = "memory";
    const q = createQueue();
    const received: unknown[] = [];

    q.subscribe("test.command", async (msg) => {
      received.push(msg.payload);
    });

    await q.start();
    await q.publish("test.command", {
      type: "test.command",
      tenantId: "t1",
      actorId: "a1",
      correlationId: "c1",
      schemaVersion: "1.0",
      payload: { hello: "world" },
    });

    // Wait for async delivery
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ hello: "world" });

    await q.stop();
  });

  it("health check returns healthy for memory driver", async () => {
    process.env.QUEUE_DRIVER = "memory";
    const q = createQueue();
    const health = await q.healthCheck();
    expect(health.healthy).toBe(true);
    expect(health.driver).toBe("memory");
  });
});
