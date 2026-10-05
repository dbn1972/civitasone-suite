import { describe, it, expect } from "vitest";
import { scrubReasonText } from "../src/index.js";

describe("scrubReasonText", () => {
  it("masks Aadhaar, phone, email, PAN and account numbers", () => {
    const out = scrubReasonText("wrong record, aadhaar 2345 6789 0123 phone +91 98765 43210 mail a.b@x.gov.in pan ABCDE1234F acct 123456789012345");
    expect(out).not.toMatch(/2345 6789 0123|9876543210|98765 43210|a\.b@x|ABCDE1234F|123456789012345/);
    expect(out).toContain("XXXX XXXX 0123");
    expect(out).toContain("[EMAIL]");
    expect(out).toContain("wrong record");
  });
  it("caps at 500 chars", () => {
    expect(scrubReasonText("a".repeat(900)).length).toBe(500);
  });
});
