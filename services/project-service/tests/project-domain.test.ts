/**
 * Project Service — progress domain tests. 10 packs.
 */
import { describe, it, expect } from "vitest";
import { assertPhysicalPctValid, assertDprDateUnique, DomainError } from "../src/modules/progress/domain.js";

describe("progress validation", () => {
  it("0% valid", () => expect(() => assertPhysicalPctValid(0)).not.toThrow());
  it("100% valid", () => expect(() => assertPhysicalPctValid(100)).not.toThrow());
  it("50% valid", () => expect(() => assertPhysicalPctValid(50)).not.toThrow());
  it(">100% invalid", () => expect(() => assertPhysicalPctValid(101)).toThrow(DomainError));
  it("<0% invalid", () => expect(() => assertPhysicalPctValid(-1)).toThrow(DomainError));
  it("DPR date duplicate throws", () => expect(() => assertDprDateUnique(true, "2026-07-15")).toThrow(DomainError));
  it("DPR date unique passes", () => expect(() => assertDprDateUnique(false, "2026-07-15")).not.toThrow());
});
