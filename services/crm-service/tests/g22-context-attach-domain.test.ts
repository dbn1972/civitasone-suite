/**
 * G22 — Context-attach domain logic tests.
 */
import { describe, it, expect } from "vitest";
import {
  matchRule,
  extractMatchValue,
  buildTargetDescriptor,
  MATCH_TARGETS,
  ACTIONS,
} from "../src/modules/context-attach/domain.js";
import type { ContextAttachRule, InboundEvent } from "../src/modules/context-attach/domain.js";

function makeRule(overrides: Partial<ContextAttachRule> = {}): ContextAttachRule {
  return {
    id: "rule-1",
    tenantId: "t-1",
    eventType: "tracking.update",
    matchField: "sourceRef",
    matchTarget: "account",
    targetField: "externalRef",
    action: "link_activity",
    active: true,
    priority: 0,
    ...overrides,
  };
}

describe("matchRule", () => {
  it("returns the first rule matching by event_type", () => {
    const rules = [
      makeRule({ id: "r1", eventType: "tracking.update", priority: 10 }),
      makeRule({ id: "r2", eventType: "tracking.update", priority: 5 }),
      makeRule({ id: "r3", eventType: "payment.receipt", priority: 0 }),
    ];
    const event: InboundEvent = { eventType: "tracking.update", payload: {} };
    const result = matchRule(event, rules);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("r2"); // lower priority wins
  });

  it("returns null when no rule matches", () => {
    const rules = [makeRule({ eventType: "payment.receipt" })];
    const event: InboundEvent = { eventType: "tracking.update", payload: {} };
    expect(matchRule(event, rules)).toBeNull();
  });

  it("skips inactive rules", () => {
    const rules = [
      makeRule({ id: "r1", eventType: "tracking.update", active: false }),
      makeRule({ id: "r2", eventType: "tracking.update", active: true, priority: 99 }),
    ];
    const event: InboundEvent = { eventType: "tracking.update", payload: {} };
    const result = matchRule(event, rules);
    expect(result!.id).toBe("r2");
  });

  it("returns null for empty rules array", () => {
    const event: InboundEvent = { eventType: "tracking.update", payload: {} };
    expect(matchRule(event, [])).toBeNull();
  });

  it("handles multiple rules with same priority (stable sort — first defined wins)", () => {
    const rules = [
      makeRule({ id: "r1", eventType: "tracking.update", priority: 5 }),
      makeRule({ id: "r2", eventType: "tracking.update", priority: 5 }),
    ];
    const event: InboundEvent = { eventType: "tracking.update", payload: {} };
    const result = matchRule(event, rules);
    expect(result!.id).toBe("r1");
  });
});

describe("extractMatchValue", () => {
  it("extracts a top-level string field", () => {
    const event: InboundEvent = {
      eventType: "tracking.update",
      payload: { sourceRef: "ACC-12345" },
    };
    expect(extractMatchValue(event, "sourceRef")).toBe("ACC-12345");
  });

  it("extracts a nested field using dot notation", () => {
    const event: InboundEvent = {
      eventType: "tracking.update",
      payload: { data: { sourceRef: "REF-99" } },
    };
    expect(extractMatchValue(event, "data.sourceRef")).toBe("REF-99");
  });

  it("converts numeric values to strings", () => {
    const event: InboundEvent = {
      eventType: "tracking.update",
      payload: { orderId: 42 },
    };
    expect(extractMatchValue(event, "orderId")).toBe("42");
  });

  it("returns null for missing field", () => {
    const event: InboundEvent = {
      eventType: "tracking.update",
      payload: { other: "value" },
    };
    expect(extractMatchValue(event, "sourceRef")).toBeNull();
  });

  it("returns null for null field value", () => {
    const event: InboundEvent = {
      eventType: "tracking.update",
      payload: { sourceRef: null },
    };
    expect(extractMatchValue(event, "sourceRef")).toBeNull();
  });

  it("returns null for object/array field value", () => {
    const event: InboundEvent = {
      eventType: "tracking.update",
      payload: { sourceRef: { nested: true } },
    };
    expect(extractMatchValue(event, "sourceRef")).toBeNull();
  });

  it("returns null when traversing through a non-object", () => {
    const event: InboundEvent = {
      eventType: "tracking.update",
      payload: { data: "not-an-object" },
    };
    expect(extractMatchValue(event, "data.sourceRef")).toBeNull();
  });

  it("handles deeply nested paths", () => {
    const event: InboundEvent = {
      eventType: "tracking.update",
      payload: { a: { b: { c: { ref: "DEEP-1" } } } },
    };
    expect(extractMatchValue(event, "a.b.c.ref")).toBe("DEEP-1");
  });

  it("returns null for empty string match field", () => {
    const event: InboundEvent = {
      eventType: "tracking.update",
      payload: { "": "empty-key" },
    };
    // Empty string splits into [""] which matches the key ""
    expect(extractMatchValue(event, "")).toBe("empty-key");
  });
});

describe("buildTargetDescriptor", () => {
  it("returns a typed target descriptor", () => {
    const result = buildTargetDescriptor("ACC-12345", "account", "uuid-1");
    expect(result).toEqual({ type: "account", id: "uuid-1" });
  });

  it("works for all target types", () => {
    for (const t of MATCH_TARGETS) {
      const result = buildTargetDescriptor("val", t, "uuid-x");
      expect(result.type).toBe(t);
    }
  });
});

describe("constants", () => {
  it("MATCH_TARGETS contains expected values", () => {
    expect(MATCH_TARGETS).toEqual(["account", "contact", "deal", "case"]);
  });

  it("ACTIONS contains expected values", () => {
    expect(ACTIONS).toEqual(["link_activity", "link_document", "create_task"]);
  });
});
