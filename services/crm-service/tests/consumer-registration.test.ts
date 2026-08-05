/**
 * Consumer registration guard.
 *
 * A command topic with no subscriber is silent data loss: the route validates,
 * publishes and answers 202 Accepted, and the write is never applied. This test
 * wires the same registrar the worker uses and fails if any topic in COMMANDS
 * is left without a handler.
 */
import { describe, it, expect } from "vitest";
import { registerAllConsumers } from "../src/consumers.js";
import { COMMANDS } from "../src/topics.js";
import { CONTACT_ACTIVITY_TOPIC } from "../src/modules/communications/contact-activity-consumer.js";

function collectSubscriptions(): string[] {
  const topics: string[] = [];
  const mockQueue = {
    subscribe: (topic: string) => { topics.push(topic); },
    publish: async () => "mock-id",
    start: async () => {},
    stop: async () => {},
  };
  registerAllConsumers(mockQueue as never);
  return topics;
}

describe("crm-service consumer registration", () => {
  const subscribed = collectSubscriptions();

  it("every COMMANDS topic has a subscriber", () => {
    const missing = Object.entries(COMMANDS)
      .filter(([, topic]) => !subscribed.includes(topic))
      .map(([name, topic]) => `${name} (${topic})`);
    expect(missing).toEqual([]);
  });

  it("registers the previously orphaned command topics", () => {
    for (const topic of [
      COMMANDS.leadConvert,
      COMMANDS.closeDeal,
      COMMANDS.transferOwnership,
      COMMANDS.inboundCapture,
      COMMANDS.leadTransition,
      COMMANDS.createPipeline,
      COMMANDS.updatePipeline,
      COMMANDS.deletePipeline,
    ]) {
      expect(subscribed).toContain(topic);
    }
  });

  it("subscribes the BRD 9.4 contact-activity projection topic (cross-service)", () => {
    // Not a COMMANDS topic — a topic consumed from the Communication Hub.
    // Guarded here so the projection consumer stays wired into registerAllConsumers.
    expect(subscribed).toContain(CONTACT_ACTIVITY_TOPIC);
  });

  it("subscribes each command topic exactly once", () => {
    const duplicates = [...new Set(subscribed)].filter(
      (t) => subscribed.filter((s) => s === t).length > 1,
    );
    expect(duplicates).toEqual([]);
  });
});
