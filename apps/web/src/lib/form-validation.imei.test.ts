import { describe, it, expect } from "vitest";
import { isValidIccid, isValidImei, luhnValid } from "./form-validation";

describe("IMEI / ICCID validation (GAP-ASSETS-FLEET-DEVICES-06)", () => {
  it("accepts a valid IMEI and rejects a bad checksum or non-digits", () => {
    expect(isValidImei("490154203237518")).toBe(true);
    expect(isValidImei("490154203237519")).toBe(false);
    expect(isValidImei("abcdefghijklmno")).toBe(false);
    expect(isValidImei("49015420323751")).toBe(false);
    expect(isValidImei("4901542032375180")).toBe(false);
  });
  it("can skip the checksum for vendors with non-Luhn test IMEIs", () => {
    expect(isValidImei("123456789012345", false)).toBe(true);
    expect(isValidImei("12345678901234a", false)).toBe(false);
  });
  it("ICCID is 19 or 20 digits", () => {
    expect(isValidIccid("8991000000000000000")).toBe(true);
    expect(isValidIccid("89910000000000000000")).toBe(true);
    expect(isValidIccid("899100000000000000")).toBe(false);
    expect(isValidIccid("89910000000000000AB")).toBe(false);
  });
  it("luhnValid", () => {
    expect(luhnValid("79927398713")).toBe(true);
    expect(luhnValid("79927398710")).toBe(false);
  });
});
