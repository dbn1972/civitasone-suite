/**
 * Consumer registration guard.
 *
 * A command topic with no subscriber is silent data loss: the route
 * validates, publishes, and answers 202 Accepted, but the write is never
 * applied. This test wires the same four registrars src/worker.ts uses and
 * fails if any topic in COMMANDS is left without a handler, or is
 * accidentally double-subscribed (which would double-apply the write on
 * every delivery).
 */
import { describe, it, expect } from "vitest";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { registerBulkGeneratorConsumers } from "../src/modules/bulk_generators/consumer.js";
import { registerCollectionConsumers } from "../src/modules/collection/consumer.js";
import { registerAnalyticsConsumers } from "../src/modules/analytics/consumer.js";
import { COMMANDS } from "../src/topics.js";

function collectSubscriptions(): string[] {
  const topics: string[] = [];
  const mockQueue = {
    subscribe: (topic: string) => {
      topics.push(topic);
    },
    publish: async () => "mock-id",
    start: async () => {},
    stop: async () => {},
  };
  registerComplaintConsumers(mockQueue as never);
  registerBulkGeneratorConsumers(mockQueue as never);
  registerCollectionConsumers(mockQueue as never);
  registerAnalyticsConsumers(mockQueue as never);
  return topics;
}

describe("swm-service consumer registration", () => {
  const subscribed = collectSubscriptions();

  it("every COMMANDS topic has a subscriber", () => {
    const missing = Object.entries(COMMANDS)
      .filter(([, topic]) => !subscribed.includes(topic))
      .map(([name, topic]) => `${name} (${topic})`);
    expect(missing).toEqual([]);
  });

  it("subscribes each command topic exactly once", () => {
    const duplicates = [...new Set(subscribed)].filter(
      (t) => subscribed.filter((s) => s === t).length > 1,
    );
    expect(duplicates).toEqual([]);
  });
});
