/**
 * Audit Service — tamper-evident chain hash. ~8 packs.
 */
import { describe, it, expect } from "vitest";
import { computeHash } from "../src/modules/events/domain.js";

describe("audit computeHash — tamper-evident chain", () => {
  it("deterministic for same inputs", () => {
    const h1 = computeHash("e1", "t1", "login", "prev", "2026-07-15T10:00:00Z", { actor: "u1", target: "sys", payload: {} });
    const h2 = computeHash("e1", "t1", "login", "prev", "2026-07-15T10:00:00Z", { actor: "u1", target: "sys", payload: {} });
    expect(h1).toBe(h2);
  });
  it("different content → different hash", () => {
    const h1 = computeHash("e1", "t1", "login", "prev", "2026-07-15T10:00:00Z", { actor: "u1", target: null, payload: {} });
    const h2 = computeHash("e1", "t1", "login", "prev", "2026-07-15T10:00:00Z", { actor: "u2", target: null, payload: {} });
    expect(h1).not.toBe(h2);
  });
  it("chains: different prevHash → different output", () => {
    const h1 = computeHash("e1", "t1", "x", "hash-a", "2026-07-15T10:00:00Z", { actor: null, target: null, payload: {} });
    const h2 = computeHash("e1", "t1", "x", "hash-b", "2026-07-15T10:00:00Z", { actor: null, target: null, payload: {} });
    expect(h1).not.toBe(h2);
  });
  it("returns 64-char hex", () => {
    const h = computeHash("id", "t", "type", null, "ts", { actor: null, target: null, payload: null });
    expect(h.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });
});
