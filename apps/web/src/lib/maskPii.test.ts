import { describe, it, expect } from "vitest";
import { maskEmail } from "./maskPii";

describe("maskEmail", () => {
  it("masks local part and host, keeps the TLD", () => {
    expect(maskEmail("asha.verma@dept.gov.in")).toBe("a***@d***.in");
    expect(maskEmail("ravi@example.com")).toBe("r***@e***.com");
  });
  it("never leaks the full value for odd input", () => {
    expect(maskEmail("nope")).toBe("***");
    expect(maskEmail("@x.com")).toBe("***");
    expect(maskEmail(null)).toBe("—");
  });
});
