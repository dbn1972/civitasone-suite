import { describe, it, expect } from "vitest";
import {
  isEmailAddress,
  isIndianMobile,
  isValidRecipientToken,
  validateRecipientTokens,
  CAMPAIGN_RECIPIENT_LIMIT,
} from "./form-validation";

// GAP-NOTIFICATIONS-CAMPAIGNS-02: recipient tokens typed by hand must be
// validated before a campaign is created — a bad token used to be accepted and
// only fail asynchronously in Deliveries.
describe("recipient-token validation", () => {
  it("accepts valid emails", () => {
    expect(isEmailAddress("asha@example.gov.in")).toBe(true);
    expect(isValidRecipientToken("asha@example.gov.in")).toBe(true);
  });

  it("accepts valid Indian mobiles (with/without +91/0)", () => {
    expect(isIndianMobile("9876543210")).toBe(true);
    expect(isIndianMobile("+919876543210")).toBe(true);
    expect(isIndianMobile("09876543210")).toBe(true);
    expect(isValidRecipientToken("9876543210")).toBe(true);
  });

  it("rejects a bare word and a too-short number", () => {
    expect(isValidRecipientToken("abc")).toBe(false); // not email/mobile/handle (too short-ish bare word)
    expect(isValidRecipientToken("123")).toBe(false); // too short to be a phone
    expect(isEmailAddress("not-an-email")).toBe(false);
    expect(isIndianMobile("12345")).toBe(false);
    expect(isIndianMobile("1234567890")).toBe(false); // must start 6-9
  });

  it("accepts an opaque handle for in-app/push", () => {
    expect(isValidRecipientToken("user-7f3a")).toBe(true);
  });

  it("collects invalid tokens and flags over-limit", () => {
    const res = validateRecipientTokens(["a@x.in", "abc", "9876543210", "nope"]);
    expect(res.invalid).toEqual(["abc", "nope"]);
    expect(res.overLimit).toBe(false);
  });

  it("flags a list over the recipient cap", () => {
    const many = Array.from({ length: CAMPAIGN_RECIPIENT_LIMIT + 1 }, (_, i) => `u${i}@x.in`);
    expect(validateRecipientTokens(many).overLimit).toBe(true);
  });
});
