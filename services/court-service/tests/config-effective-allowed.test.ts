/**
 * §47 config-authoritative-when-present semantics for the config/metadata engine.
 * effectiveAllowed(configuredKeys, fallback):
 *   - no tenant config  → the module defaults apply
 *   - any tenant config → that set is AUTHORITATIVE (replaces defaults), so a
 *     tenant can RESTRICT to exactly its vertical's allowed values, not merely add.
 */
import { describe, it, expect } from "vitest";
import { effectiveAllowed } from "../src/modules/config-registry/domain.js";

describe("effectiveAllowed — config drives the allowed set (§47)", () => {
  const DEFAULTS = ["civil", "criminal", "revenue_appeal"] as const;

  it("falls back to module defaults when the tenant has configured nothing", () => {
    const allowed = effectiveAllowed([], DEFAULTS);
    expect(allowed.has("civil")).toBe(true);
    expect(allowed.has("mutation")).toBe(false);
  });

  it("is AUTHORITATIVE when the tenant configures a set — defaults are replaced", () => {
    const allowed = effectiveAllowed(["mutation", "partition"], DEFAULTS);
    // the tenant's bespoke values are allowed …
    expect(allowed.has("mutation")).toBe(true);
    expect(allowed.has("partition")).toBe(true);
    // … and a former default is now REJECTED (a revenue court can restrict away
    // e.g. "criminal") — this is the core multi-vertical configurability.
    expect(allowed.has("criminal")).toBe(false);
    expect(allowed.has("civil")).toBe(false);
  });

  it("a single configured value restricts the tenant to exactly that value", () => {
    const allowed = effectiveAllowed(["consumer_complaint"], DEFAULTS);
    expect([...allowed]).toEqual(["consumer_complaint"]);
  });
});
