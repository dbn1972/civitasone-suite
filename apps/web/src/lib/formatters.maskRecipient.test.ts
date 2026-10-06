import { describe, it, expect } from "vitest";
import { maskRecipient } from "./formatters";

describe("maskRecipient (GAP-NOTIFICATIONS-LIST-01)", () => {
  it("masks an email keeping only first chars", () => {
    expect(maskRecipient("asha@example.gov.in")).toBe("a***@e******.g**.i*");
  });

  it("masks a 10-digit mobile keeping first 2 and last 3", () => {
    expect(maskRecipient("9876543210")).toBe("98XXXXX210");
  });

  it("masks a mobile with +91 and spaces (keeps the leading digits of the full number)", () => {
    expect(maskRecipient("+91 98765 43210")).toBe("91XXXXXXX210");
  });

  it("masks an opaque handle to first char + bullets", () => {
    expect(maskRecipient("user-7f3a")).toMatch(/^u•+$/);
  });

  it("renders — for missing input (never a fabricated blank)", () => {
    expect(maskRecipient(null)).toBe("—");
    expect(maskRecipient(undefined)).toBe("—");
    expect(maskRecipient("   ")).toBe("—");
  });

  it("never returns the original value for a populated recipient", () => {
    for (const v of ["asha@example.gov.in", "9876543210", "user-7f3a"]) {
      expect(maskRecipient(v)).not.toBe(v);
    }
  });
});
