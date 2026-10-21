import { describe, it, expect } from "vitest";
import { displayMaskedEmail, displayMaskedPhone } from "./maskedPii";

describe("contact PII display masking", () => {
  it("masks a clear phone and email", () => {
    expect(displayMaskedPhone("9876543210")).toBe("98XXXXX210");
    expect(displayMaskedEmail("asha@example.com")).toBe("a***@e******.c**");
  });

  it("passes through a value the server already redacted instead of collapsing it", () => {
    expect(displayMaskedPhone("******3210")).toBe("******3210");
    expect(displayMaskedEmail("a***@example.com")).toBe("a***@example.com");
  });

  it("returns null for an absent value", () => {
    expect(displayMaskedPhone(null)).toBeNull();
    expect(displayMaskedPhone("")).toBeNull();
    expect(displayMaskedEmail(undefined)).toBeNull();
  });

  it("never returns the clear value for a clear input", () => {
    expect(displayMaskedPhone("9876543210")).not.toContain("9876543210");
    expect(displayMaskedEmail("asha@example.com")).not.toContain("asha@");
  });
});
