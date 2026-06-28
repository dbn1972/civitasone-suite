import { describe, it, expect } from "vitest";
import { computeNotingHash } from "../src/modules/files/domain.js";

const N1 = "11111111-1111-1111-1111-111111111111";
const OFF = "22222222-2222-2222-2222-222222222222";

describe("per-level green-note hash chain (G2)", () => {
  it("is deterministic for the same inputs", () => {
    const a = computeNotingHash(N1, "Recommended for approval", OFF, "", 1_700_000_000_000);
    const b = computeNotingHash(N1, "Recommended for approval", OFF, "", 1_700_000_000_000);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes if the note body is tampered (tamper-evident)", () => {
    const orig = computeNotingHash(N1, "Approve ₹5,00,000", OFF, "prevhash", 1_700_000_000_000);
    const tampered = computeNotingHash(N1, "Approve ₹50,00,000", OFF, "prevhash", 1_700_000_000_000);
    expect(tampered).not.toBe(orig);
  });

  it("links to the previous note: changing prevHash changes the hash", () => {
    const linkedToA = computeNotingHash(N1, "ok", OFF, "hashA", 1_700_000_000_000);
    const linkedToB = computeNotingHash(N1, "ok", OFF, "hashB", 1_700_000_000_000);
    expect(linkedToA).not.toBe(linkedToB);
  });

  it("differs per signing officer", () => {
    const byOff = computeNotingHash(N1, "ok", OFF, "", 1);
    const byOther = computeNotingHash(N1, "ok", "33333333-3333-3333-3333-333333333333", "", 1);
    expect(byOff).not.toBe(byOther);
  });
});
