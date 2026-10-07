import { describe, expect, it } from "vitest";
import { detectIdentifiers, maskIdentifiers } from "./pii";

describe("detectIdentifiers", () => {
  it("detects a grouped Aadhaar number", () => {
    expect(detectIdentifiers("my aadhaar is 1234 5678 9012 ok")).toBe(true);
  });

  it("detects a bare 12-digit Aadhaar", () => {
    expect(detectIdentifiers("123456789012")).toBe(true);
  });

  it("detects a PAN", () => {
    expect(detectIdentifiers("PAN ABCDE1234F")).toBe(true);
  });

  it("returns false for ordinary text", () => {
    expect(detectIdentifiers("summarise the pending approvals")).toBe(false);
    expect(detectIdentifiers("")).toBe(false);
    expect(detectIdentifiers(null)).toBe(false);
  });

  it("is stable across repeated calls (regex lastIndex reset)", () => {
    expect(detectIdentifiers("123456789012")).toBe(true);
    expect(detectIdentifiers("123456789012")).toBe(true);
  });
});

describe("maskIdentifiers", () => {
  it("masks a grouped Aadhaar keeping the last 4", () => {
    expect(maskIdentifiers("1234 5678 9012")).toBe("XXXX XXXX 9012");
  });

  it("masks a bare 12-digit run keeping the last 4", () => {
    expect(maskIdentifiers("123456789012")).toBe("XXXXXXXX9012");
  });

  it("masks a PAN keeping first 2 and last char", () => {
    expect(maskIdentifiers("PAN ABCDE1234F")).toBe("PAN ABXXXXXXF");
  });

  it("leaves ordinary text untouched", () => {
    expect(maskIdentifiers("summarise the pending approvals")).toBe("summarise the pending approvals");
  });

  it("returns an empty string for nullish input", () => {
    expect(maskIdentifiers(null)).toBe("");
    expect(maskIdentifiers(undefined)).toBe("");
  });
});

// GAP-AI-CHAT-DETAIL-02: phone & email are redacted in chat transcript text too.
describe("maskIdentifiers — phone & email (GAP-AI-CHAT-DETAIL-02)", () => {
  it("masks a 10-digit Indian mobile keeping first 2 and last 3", () => {
    expect(maskIdentifiers("call me on 9876543210")).toBe("call me on 98XXXXX210");
  });

  it("masks a +91-prefixed mobile (redacted, keeps only the last 3-4 digits)", () => {
    const out = maskIdentifiers("+919876543210");
    expect(out).toContain("X");
    expect(out).not.toContain("9876543");
    expect(out.endsWith("210")).toBe(true);
  });

  it("masks an email address", () => {
    expect(maskIdentifiers("write to asha@dept.gov.in please")).toBe("write to a***@d*** please");
  });

  it("detects a phone number as an identifier", () => {
    expect(detectIdentifiers("9876543210")).toBe(true);
  });

  it("detects an email as an identifier", () => {
    expect(detectIdentifiers("asha@dept.gov.in")).toBe(true);
  });

  it("leaves ordinary numbers that are not phone-shaped alone", () => {
    // A 4-digit token is neither a long run nor a mobile prefix.
    expect(maskIdentifiers("room 1204")).toBe("room 1204");
  });
});
