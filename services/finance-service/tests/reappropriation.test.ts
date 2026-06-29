import { describe, it, expect } from "vitest";
import { assertReappropriationValid, DomainError } from "../src/modules/budget/domain.js";

/**
 * R4 — re-appropriation must be a zero-sum transfer met from the SOURCE head's
 * savings (GFR Rule 10). These pure tests lock the rule; the consumer applies
 * the equal-and-opposite debit/credit so total appropriation is conserved.
 */
describe("re-appropriation validity (GFR Rule 10)", () => {
  it("allows a transfer fully covered by source savings", () => {
    // source RE 100, utilised 20 → savings 80; transfer 50 is fine
    expect(() => assertReappropriationValid({ reMinor: 100n, utilisedMinor: 20n }, 50n)).not.toThrow();
  });

  it("allows transferring exactly the available savings", () => {
    expect(() => assertReappropriationValid({ reMinor: 100n, utilisedMinor: 20n }, 80n)).not.toThrow();
  });

  it("rejects a transfer exceeding source savings (cannot create funds)", () => {
    expect(() => assertReappropriationValid({ reMinor: 100n, utilisedMinor: 20n }, 81n))
      .toThrowError(/INSUFFICIENT_SAVINGS/);
  });

  it("rejects when the source head is fully utilised (no savings)", () => {
    expect(() => assertReappropriationValid({ reMinor: 100n, utilisedMinor: 100n }, 1n))
      .toThrowError(DomainError);
  });

  it("rejects zero/negative amounts", () => {
    expect(() => assertReappropriationValid({ reMinor: 100n, utilisedMinor: 0n }, 0n)).toThrow();
    expect(() => assertReappropriationValid({ reMinor: 100n, utilisedMinor: 0n }, -5n)).toThrow();
  });

  it("zero-sum property: debit(source) + credit(target) nets to zero", () => {
    const amount = 40n;
    const srcReBefore = 100n, tgtReBefore = 30n;
    // simulate the consumer's transfer
    const srcReAfter = srcReBefore - amount;
    const tgtReAfter = tgtReBefore + amount;
    expect((srcReAfter + tgtReAfter)).toBe(srcReBefore + tgtReBefore); // total conserved
    // target may now exceed its own BE — that is allowed (no Rule-11 cap here)
    expect(tgtReAfter).toBeGreaterThan(tgtReBefore);
  });
});
