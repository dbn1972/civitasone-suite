import { describe, it, expect } from "vitest";
import { addBoqItemSchema } from "../src/modules/boq/validators.js";

const base = {
  workId: "11111111-1111-4111-8111-111111111111",
  itemDescription: "PCC 1:4:8",
  unit: "cum",
  rate: "12500",
};

describe("GAP-WORKS-BOQ-NEW-04: BoQ quantity accepts a decimal string", () => {
  it("Given a decimal string quantity, When parsed, Then it normalises to the exact number", () => {
    const r = addBoqItemSchema.parse({ ...base, quantity: "12.345" });
    expect(r.quantity).toBe(12.345);
  });

  it("Given a plain positive number, When parsed, Then existing callers still work", () => {
    expect(addBoqItemSchema.parse({ ...base, quantity: 2 }).quantity).toBe(2);
  });

  it("Given a zero, negative, exponent or over-precise string, When parsed, Then it is rejected", () => {
    for (const q of ["0", "0.0000", "-1", "1e3", "1.23456", "abc", ""]) {
      expect(addBoqItemSchema.safeParse({ ...base, quantity: q }).success, q).toBe(false);
    }
  });
});
