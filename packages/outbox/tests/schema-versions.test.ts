import { describe, it, expect } from "vitest";
import { getTopicSchemaVersion, DEFAULT_SCHEMA_VERSION } from "../src/schema-versions.js";

/**
 * PERF-008 — per-topic schema-version registry.
 *
 * The registry is deliberately empty today (see schema-versions.ts's own
 * header for why that's the honest, accurate state, not a placeholder) — so
 * what's actually testable right now is the fallback mechanism itself: every
 * topic, known or unknown, resolves to DEFAULT_SCHEMA_VERSION until this
 * file's map gets a real entry. That IS the whole current behavior of
 * getTopicSchemaVersion (`map[topic] ?? DEFAULT_SCHEMA_VERSION`), so this
 * fully exercises it without fabricating a fake registered topic.
 */
describe("getTopicSchemaVersion", () => {
  it("resolves DEFAULT_SCHEMA_VERSION for any topic (registry currently empty)", () => {
    expect(DEFAULT_SCHEMA_VERSION).toBe("1.0");
    expect(getTopicSchemaVersion("tenant.tenant.created")).toBe("1.0");
    expect(getTopicSchemaVersion("search.index.update")).toBe("1.0");
    expect(getTopicSchemaVersion("some.topic.nobody.registered.yet")).toBe("1.0");
  });

  it("is a pure function of the topic string (no shared mutable state leaks between calls)", () => {
    const a = getTopicSchemaVersion("topic.a");
    const b = getTopicSchemaVersion("topic.b");
    expect(a).toBe(DEFAULT_SCHEMA_VERSION);
    expect(b).toBe(DEFAULT_SCHEMA_VERSION);
    // Re-querying "topic.a" is unaffected by having queried "topic.b" in between.
    expect(getTopicSchemaVersion("topic.a")).toBe(a);
  });
});
