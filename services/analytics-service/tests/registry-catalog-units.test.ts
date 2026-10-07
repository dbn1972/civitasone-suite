/**
 * GAP-ANALYTICS-QUERIES-04 + -02 — pure tests (no DB connection).
 *
 * -04: the discovery catalog must declare each metric's unit so the UI can
 *      format money (paise) as ₹ and counts as plain tallies.
 * -02: a failed query run's persisted `error` must be a safe, user-facing
 *      message — validation/registry failures pass through, anything else is
 *      mapped to a generic message so no raw DB/driver internals can leak.
 */
import { describe, it, expect } from "vitest";
import { catalog } from "../src/modules/registry/registry.js";
import { RegistryError } from "../src/modules/registry/registry.js";
import { sanitizeRunError } from "../src/modules/queries/consumer.js";
import { querySpecSchema } from "../src/modules/registry/spec.js";

describe("GAP-04: catalog declares a unit for every metric", () => {
  const cat = catalog();

  it("every metric carries a unit of 'paise' or 'count'", () => {
    expect(cat.metrics.length).toBeGreaterThan(0);
    for (const m of cat.metrics) {
      expect(["paise", "count"]).toContain((m as { unit: string }).unit);
    }
  });

  it("amount_* metrics are paise (money) and event_count is a count", () => {
    const byKey = Object.fromEntries(cat.metrics.map((m) => [m.key, m as { unit: string }]));
    expect(byKey.amount_sum.unit).toBe("paise");
    expect(byKey.amount_avg.unit).toBe("paise");
    expect(byKey.amount_max.unit).toBe("paise");
    expect(byKey.amount_min.unit).toBe("paise");
    expect(byKey.event_count.unit).toBe("count");
  });
});

describe("GAP-02: sanitizeRunError never leaks internals", () => {
  it("passes a whitelist (RegistryError) message through", () => {
    const msg = sanitizeRunError(new RegistryError("UNKNOWN_METRIC", "unknown metric: bogus"));
    expect(msg).toBe("unknown metric: bogus");
  });

  it("summarises a Zod validation error safely", () => {
    let caught: unknown;
    try {
      querySpecSchema.parse({ metric: "not_a_metric", dimensions: [], filters: [], limit: 10 });
    } catch (e) {
      caught = e;
    }
    const msg = sanitizeRunError(caught);
    expect(msg.startsWith("Invalid query:")).toBe(true);
    expect(msg.length).toBeLessThanOrEqual(500);
  });

  it("maps a raw database error to a generic, non-leaky message", () => {
    const dbErr = new Error('syntax error at or near "=" in SELECT analytics.fact_events.amount');
    const msg = sanitizeRunError(dbErr);
    expect(msg).not.toContain("fact_events");
    expect(msg).not.toContain("syntax error");
    expect(msg).toBe(
      "The query could not be completed. Please adjust it and try again, or contact support if this persists.",
    );
  });

  it("caps long messages to the column width", () => {
    const msg = sanitizeRunError(new RegistryError("X", "a".repeat(900)));
    expect(msg.length).toBeLessThanOrEqual(500);
  });
});
