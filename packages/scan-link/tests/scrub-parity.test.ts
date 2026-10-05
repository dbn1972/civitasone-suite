/**
 * PARITY: scan-link's scrubReasonText must behave exactly like @civitasone/ocr's scrubString (the copies exist
 * because target services must not depend on the ocr package's sharp/pdfjs). The ocr module is imported by
 * relative SOURCE path here (test-only), so scan-link keeps zero runtime dependency on it.
 */
import { describe, expect, it } from "vitest";
import { scrubForLog, scrubString } from "../../ocr/src/post/pii.js";
import { scrubReasonText } from "../src/index.js";

const CORPUS: string[] = [
  "wrong record, aadhaar 2345 6789 0123 phone +91 98765 43210 mail a.b@x.gov.in pan ABCDE1234F acct 123456789012345",
  "2345 6789 0123", "2345-6789-0123", "234567890123", "2345  6789  0123", "2345\n6789\n0123", "2345\r\n6789 0123", "2345 - 6789 - 0123",
  "1234 5678 9012 3456", "1234-5678-9012-3456", "1234567890123456", "1234  5678  9012  3456", "1234\n5678\n9012\n3456", "VID 9999 8888 7777 6666 end",
  "1234 5678 9012 3456 78", "12345678901234567", "123456789012345678", "1234567890123456789",
  "9876543210", "+91 98765 43210", "+91-9876543210", "919876543210", "098765 43210", "98765-43210",
  "a/c 123456789", "acct 12345678", "acct 1234567890", "ref 999999999",
  "ABCPE1234F", "abcpe1234f", "ABCPE1234 F", "xABCPE1234Fx", "ABCDE12O4F",
  "a.b@x.gov.in", "first.last+tag@sub.example.co.in and b@c.de", "not an email@",
  "Rs. 1,23,456", "2024-03-12", "12 pages 3 copies", "pin 560001", "", "plain text only",
  "mix 2345 6789 0123, 9876543210, ABCPE1234F, a@b.in, 1234567890123456",
  "2345 6789 0123 4567 8901",
];

describe("scan-link scrubReasonText <-> ocr scrubString parity", () => {
  for (const s of CORPUS) {
    it(`same output for ${JSON.stringify(s).slice(0, 60)}`, () => {
      expect(scrubReasonText(s, Number.MAX_SAFE_INTEGER)).toBe(scrubString(s));
    });
  }

  it("scrubForLog on a string equals scrubString (so all three agree)", () => {
    for (const s of CORPUS) expect(scrubForLog(s)).toBe(scrubString(s));
  });

  it("after scrubbing, no corpus line retains more than the last 4 digits of any digit group", () => {
    for (const s of CORPUS.filter((x) => /\d{9,}|\d{4}[\s-]+\d{4}/.test(x))) {
      const out = scrubReasonText(s);
      expect(out).not.toMatch(/\d{5,}/);
    }
  });

  it("the default 500-char cap is the only intended difference", () => {
    expect(scrubReasonText("a".repeat(900)).length).toBe(500);
    expect(scrubString("a".repeat(900)).length).toBe(900);
  });
});
