/**
 * Visitor Service — Blacklist Domain: Deep tests.
 * Source: modules/blacklist/domain.ts
 */
import { describe, it, expect } from "vitest";
import { normalizeName, FUZZY_NAME_THRESHOLD, screenIdentity, assertDistinctMakerChecker, assertBlacklistTransition, isExpired, DomainError, type BlacklistStatus } from "../src/modules/blacklist/domain.js";

describe("normalizeName — fuzzy matching key", () => {
  it("lowercases and strips diacritics", () => expect(normalizeName("José García")).toBe("jose garcia"));
  it("replaces non-alphanumeric with space", () => expect(normalizeName("Mr. Singh (IAS)")).toBe("mr singh ias"));
  it("trims and collapses spaces", () => expect(normalizeName("  John   Doe  ")).toBe("john doe"));
});

describe("screenIdentity — blacklist/watchlist screening", () => {
  const bl = new Set(["hash-blocked-1"]);
  const wl = new Set(["hash-flagged-1"]);
  it("blocked when docHash in blacklist", () => expect(screenIdentity("hash-blocked-1", bl, wl)).toEqual({ blocked: true, flagged: false }));
  it("flagged when in watchlist but not blacklist", () => expect(screenIdentity("hash-flagged-1", bl, wl)).toEqual({ blocked: false, flagged: true }));
  it("clear when in neither", () => expect(screenIdentity("hash-clean", bl, wl)).toEqual({ blocked: false, flagged: false }));
  it("null docHash = clear (no identity doc)", () => expect(screenIdentity(null, bl, wl)).toEqual({ blocked: false, flagged: false }));
  it("blacklist takes precedence over watchlist", () => { const both = new Set(["hash-x"]); expect(screenIdentity("hash-x", both, both).blocked).toBe(true); });
});

describe("assertDistinctMakerChecker — SOD", () => {
  it("passes when different", () => expect(() => assertDistinctMakerChecker("A", "B")).not.toThrow());
  it("throws SOD_VIOLATION on self-approval", () => expect(() => assertDistinctMakerChecker("A", "A")).toThrow("SOD_VIOLATION"));
});

describe("assertBlacklistTransition — lifecycle", () => {
  const valid: [string, BlacklistStatus][] = [["pending", "active"], ["pending", "archived"], ["active", "expired"], ["active", "archived"], ["expired", "archived"]];
  for (const [f, t] of valid) it(`${f} → ${t}`, () => expect(() => assertBlacklistTransition(f, t)).not.toThrow());
  it("archived is terminal", () => expect(() => assertBlacklistTransition("archived", "active")).toThrow("INVALID_TRANSITION"));
  it("expired → active is illegal", () => expect(() => assertBlacklistTransition("expired", "active")).toThrow(DomainError));
});

describe("isExpired", () => {
  it("false for null expiresAt (never expires)", () => expect(isExpired(null)).toBe(false));
  it("true when past", () => expect(isExpired(new Date("2020-01-01"))).toBe(true));
  it("false when future", () => expect(isExpired(new Date("2099-01-01"))).toBe(false));
});

describe("FUZZY_NAME_THRESHOLD", () => {
  it("is 0.45", () => expect(FUZZY_NAME_THRESHOLD).toBe(0.45));
});
