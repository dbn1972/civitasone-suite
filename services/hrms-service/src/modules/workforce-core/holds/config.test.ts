/**
 * Hold-blocking configuration (SmartTransfer OS, ST-M01-10) — unit tests.
 *
 * Proves the conservative default and the env narrowing of PROPOSED D-ST-16:
 * which hold types block a posting is CONFIGURATION, defaulting to "every
 * active hold blocks" when unset. No DB. No z.coerce (house rule 8).
 */
import { describe, it, expect } from "vitest";
import {
  blockingHoldTypes,
  KNOWN_HOLD_TYPES,
  BLOCKING_HOLD_TYPES_ENV,
} from "./config.js";

function env(value?: string): NodeJS.ProcessEnv {
  return value === undefined ? {} : { [BLOCKING_HOLD_TYPES_ENV]: value };
}

describe("blockingHoldTypes — conservative default", () => {
  it("blocks every known hold type when the env is unset", () => {
    const set = blockingHoldTypes(env());
    expect(set.size).toBe(KNOWN_HOLD_TYPES.length);
    for (const t of KNOWN_HOLD_TYPES) expect(set.has(t)).toBe(true);
  });

  it("blocks every known hold type when the env is empty/whitespace", () => {
    expect(blockingHoldTypes(env("")).size).toBe(KNOWN_HOLD_TYPES.length);
    expect(blockingHoldTypes(env("   ")).size).toBe(KNOWN_HOLD_TYPES.length);
  });
});

describe("blockingHoldTypes — env narrows the set", () => {
  it("blocks only the listed valid hold types", () => {
    const set = blockingHoldTypes(env("transfer,promotion"));
    expect(set.has("transfer")).toBe(true);
    expect(set.has("promotion")).toBe(true);
    expect(set.has("salary")).toBe(false);
    expect(set.has("increment")).toBe(false);
    expect(set.has("all")).toBe(false);
    expect(set.size).toBe(2);
  });

  it("is case-insensitive and trims tokens", () => {
    const set = blockingHoldTypes(env("  TRANSFER , All "));
    expect(set.has("transfer")).toBe(true);
    expect(set.has("all")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("discards unknown tokens (never invents a hold type)", () => {
    const set = blockingHoldTypes(env("transfer,court_stay,vigilance"));
    expect(set.has("transfer")).toBe(true);
    expect(set.size).toBe(1);
  });

  it("falls back to the conservative default when ALL tokens are invalid", () => {
    const set = blockingHoldTypes(env("court_stay,bogus"));
    expect(set.size).toBe(KNOWN_HOLD_TYPES.length);
  });
});
