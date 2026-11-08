import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  FIELD_CODES, isRealIsoDate, istToday, addYears, addDays, yearsBetween, financialYearOf, checkDateWindow, DATE_WINDOWS,
  zIsoDate, checkAgeAtJoining, zTrimmedText, zTrimmedCode, verhoeffValid, verhoeffCheckDigit, isValidAadhaar, maskAadhaar,
  isMaskedAadhaar, zAadhaarMasked, isValidIfsc, zIfsc, isValidUan, isValidPan, isValidIndianMobile, normaliseIndianMobile, zIndianMobile, ageAtJoiningBounds,
  gstinCheckChar, isValidGstin, isValidGstStateCode, zGstin, moneyMaxMinor, checkMoneyBound, boundedMinorNumber,
  isValidFyLabel, zFyLabel, BIGINT_MAX, yearsFromEnv,
} from "../src/validators.js";

/** The field code on the first issue of a failed parse. */
function codeOf(schema: z.ZodTypeAny, value: unknown): string | undefined {
  const r = schema.safeParse(value);
  if (r.success) return undefined;
  const issue = r.error.issues[0] as { params?: { code?: string } };
  return issue.params?.code;
}

describe("isRealIsoDate (TE-01)", () => {
  it.each(["2024-02-29", "2026-04-30", "2026-12-31", "2000-02-29", "1950-01-01"])("accepts %s", (d) => {
    expect(isRealIsoDate(d)).toBe(true);
  });
  it.each([
    "2025-02-29", "2027-02-29", "1900-02-29", "2026-04-31", "2026-02-30", "2026-06-31", "2026-13-01", "2026-00-10",
    "2026-01-00", "2026-1-5", "31/04/2027", "yesterday", "next week", "", "2026-04-30T00:00:00Z", " 2026-04-30",
  ])("refuses %s", (d) => {
    expect(isRealIsoDate(d)).toBe(false);
  });
  it("refuses non-strings", () => {
    expect(isRealIsoDate(20260430)).toBe(false);
    expect(isRealIsoDate(null)).toBe(false);
  });
});

describe("date arithmetic", () => {
  it("istToday is the IST calendar day", () => {
    expect(istToday(new Date("2026-11-04T18:29:00Z"))).toBe("2026-11-04");
    expect(istToday(new Date("2026-11-04T18:31:00Z"))).toBe("2026-11-05");
  });
  it("addYears clamps 29 Feb", () => {
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(addYears("2026-11-04", -1)).toBe("2025-11-04");
  });
  it("addDays crosses month ends", () => {
    expect(addDays("2027-03-31", 1)).toBe("2027-04-01");
  });
  it("yearsBetween counts whole years", () => {
    expect(yearsBetween("2008-11-05", "2026-11-04")).toBe(17);
    expect(yearsBetween("2008-11-04", "2026-11-04")).toBe(18);
  });
  it("financialYearOf follows April-March", () => {
    expect(financialYearOf("2027-03-31")).toEqual({ start: "2026-04-01", end: "2027-03-31", label: "2026-27" });
    expect(financialYearOf("2027-04-01").label).toBe("2027-28");
    expect(financialYearOf("1999-05-01").label).toBe("1999-00");
  });
});

describe("plausible date windows (TE-07)", () => {
  const today = "2026-11-04";
  it("date of joining: 1950 .. today + 1 year", () => {
    const w = DATE_WINDOWS.dateOfJoining(today);
    expect(checkDateWindow("1800-01-01", w)?.code).toBe(FIELD_CODES.DATE_TOO_EARLY);
    expect(checkDateWindow("2999-12-31", w)?.code).toBe(FIELD_CODES.DATE_TOO_LATE);
    expect(checkDateWindow("2027-11-04", w)).toBeNull();
    expect(checkDateWindow("2027-11-05", w)?.code).toBe(FIELD_CODES.DATE_TOO_LATE);
    expect(checkDateWindow("1950-01-01", w)).toBeNull();
  });
  it("leave: 1 year back .. 2 years ahead", () => {
    const w = DATE_WINDOWS.leave(today);
    expect(checkDateWindow("1990-01-01", w)?.code).toBe(FIELD_CODES.DATE_TOO_EARLY);
    expect(checkDateWindow("2099-01-05", w)?.code).toBe(FIELD_CODES.DATE_TOO_LATE);
    expect(checkDateWindow("2025-11-04", w)).toBeNull();
    expect(checkDateWindow("2028-11-04", w)).toBeNull();
  });
  it("transaction: previous FY start .. next FY end", () => {
    const w = DATE_WINDOWS.transaction(today);
    expect(w).toEqual({ min: "2025-04-01", max: "2028-03-31" });
    expect(checkDateWindow("1990-01-01", w)?.code).toBe(FIELD_CODES.DATE_TOO_EARLY);
    expect(checkDateWindow("2099-01-01", w)?.code).toBe(FIELD_CODES.DATE_TOO_LATE);
    expect(DATE_WINDOWS.transaction(today, 2, 0)).toEqual({ min: "2024-04-01", max: "2027-03-31" });
  });
  it("upcoming and happened", () => {
    expect(checkDateWindow("2020-01-01", DATE_WINDOWS.upcoming(today))?.code).toBe(FIELD_CODES.DATE_TOO_EARLY);
    expect(checkDateWindow("2030-01-01", DATE_WINDOWS.happened(today))?.code).toBe(FIELD_CODES.DATE_TOO_LATE);
    expect(checkDateWindow(today, DATE_WINDOWS.happened(today))).toBeNull();
  });
  it("yearsFromEnv reads a bounded integer", () => {
    expect(yearsFromEnv("X", 3, { X: "5" })).toBe(5);
    expect(yearsFromEnv("X", 3, { X: "abc" })).toBe(3);
    expect(yearsFromEnv("X", 3, { X: "-1" })).toBe(3);
    expect(yearsFromEnv("X", 3, {})).toBe(3);
  });
});

describe("zIsoDate", () => {
  it("refuses an impossible date with DATE_INVALID", () => {
    expect(codeOf(zIsoDate(), "2025-02-29")).toBe(FIELD_CODES.DATE_INVALID);
    expect(codeOf(zIsoDate(), "yesterday")).toBe(FIELD_CODES.DATE_INVALID);
  });
  it("applies the window lazily", () => {
    const s = zIsoDate({ window: () => ({ min: "2026-01-01", max: "2026-12-31" }) });
    expect(codeOf(s, "2025-12-31")).toBe(FIELD_CODES.DATE_TOO_EARLY);
    expect(codeOf(s, "2027-01-01")).toBe(FIELD_CODES.DATE_TOO_LATE);
    expect(s.parse(" 2026-06-30 ")).toBe("2026-06-30");
  });
});

describe("checkAgeAtJoining", () => {
  it("needs 18-70 on the joining date", () => {
    expect(checkAgeAtJoining("2030-01-01", "2026-11-02")?.code).toBe(FIELD_CODES.AGE_OUT_OF_RANGE);
    expect(checkAgeAtJoining("2010-01-01", "2026-11-02")?.code).toBe(FIELD_CODES.AGE_OUT_OF_RANGE);
    expect(checkAgeAtJoining("1950-01-01", "2026-11-02")?.code).toBe(FIELD_CODES.AGE_OUT_OF_RANGE);
    expect(checkAgeAtJoining("1990-05-01", "2026-11-02")).toBeNull();
    expect(checkAgeAtJoining("2008-11-02", "2026-11-02")).toBeNull();
  });
});

describe("trimmed text (TE-06)", () => {
  it("refuses whitespace-only with TEXT_BLANK and trims the stored value", () => {
    const s = zTrimmedText(256, { label: "name" });
    expect(codeOf(s, "    ")).toBe(FIELD_CODES.TEXT_BLANK);
    expect(codeOf(s, "")).toBe(FIELD_CODES.TEXT_BLANK);
    expect(s.parse("  Asha Rao  ")).toBe("Asha Rao");
  });
  it("enforces min/max after trimming", () => {
    const s = zTrimmedText(5, { min: 3 });
    expect(s.safeParse("  ab  ").success).toBe(false);
    expect(s.safeParse("abcdef").success).toBe(false);
    expect(s.parse(" abc ")).toBe("abc");
    expect(zTrimmedText(10).safeParse("x".repeat(10_000)).success).toBe(false);
  });
  it("codes are one line", () => {
    expect(zTrimmedCode(32).parse("  TE-E09  ")).toBe("TE-E09");
    expect(zTrimmedCode(32).safeParse("A\nB").success).toBe(false);
  });
});

describe("Verhoeff / Aadhaar (TE-05)", () => {
  it("known Verhoeff vectors", () => {
    expect(verhoeffValid("2363")).toBe(true);
    expect(verhoeffValid("2364")).toBe(false);
    expect(verhoeffCheckDigit("236")).toBe(3);
    expect(verhoeffCheckDigit("23412341234")).toBe(6);
    expect(verhoeffCheckDigit("49911866524")).toBe(6);
    expect(verhoeffCheckDigit("98765432101")).toBe(2);
  });
  it("generated check digits always validate", () => {
    for (const base of ["23412341234", "51234567890", "87654321098", "60000000000"]) {
      expect(verhoeffValid(base + String(verhoeffCheckDigit(base)))).toBe(true);
    }
  });
  it.each(["234123412346", "4991 1866 5246", "9876-5432-1012"])("accepts Aadhaar %s", (a) => {
    expect(isValidAadhaar(a)).toBe(true);
  });
  it.each([
    "234123412347", // bad check digit
    "123412341234", // leading 1
    "023412341234", // leading 0
    "1234", // too short
    "23412341234", // 11 digits
    "2341234123467", // 13 digits
    "2341A2341234",
  ])("refuses Aadhaar %s", (a) => {
    expect(isValidAadhaar(a)).toBe(false);
  });
  it("is stored masked: only the last four digits", () => {
    expect(maskAadhaar("2341 2341 2346")).toBe("XXXX-XXXX-2346");
    expect(zAadhaarMasked.parse("234123412346")).toBe("XXXX-XXXX-2346");
    expect(zAadhaarMasked.parse("xxxx-xxxx-2346")).toBe("XXXX-XXXX-2346");
    expect(isMaskedAadhaar("XXXXXXXX2346")).toBe(true);
    expect(zAadhaarMasked.parse("XXXX XXXX 2346")).toBe("XXXX-XXXX-2346");
    expect(codeOf(zAadhaarMasked, "1234")).toBe(FIELD_CODES.AADHAAR_INVALID);
    expect(codeOf(zAadhaarMasked, "234123412347")).toBe(FIELD_CODES.AADHAAR_INVALID);
  });
});

describe("IFSC / UAN / PAN / mobile (TE-05)", () => {
  it("IFSC", () => {
    expect(isValidIfsc("SBIN0001234")).toBe(true);
    expect(isValidIfsc("HDFC0ABC123")).toBe(true);
    expect(isValidIfsc("ABCD1234567")).toBe(false);
    expect(isValidIfsc("SBI00001234")).toBe(false);
    expect(isValidIfsc("SBIN000123")).toBe(false);
    expect(zIfsc.parse(" sbin0001234 ")).toBe("SBIN0001234");
    expect(codeOf(zIfsc, "ABCD1234567")).toBe(FIELD_CODES.IFSC_INVALID);
  });
  it("UAN", () => {
    expect(isValidUan("100200300400")).toBe(true);
    expect(isValidUan("12AB")).toBe(false);
    expect(isValidUan("10020030040")).toBe(false);
    expect(isValidUan("1002003004001")).toBe(false);
  });
  it("PAN", () => {
    expect(isValidPan("ABCDE1234F")).toBe(true);
    expect(isValidPan("ABCDE1234")).toBe(false);
    expect(isValidPan("abcde1234f")).toBe(false);
  });
  it("mobile", () => {
    // PR #2465 review SF3: spaces / hyphens / brackets inside the number and the 0091 prefix are valid spellings.
    for (const ok of ["9876543210", "+919876543210", "+91 9876543210", "+91-6123456789", "09876543210", "919876543210",
      "+91 98765 43210", "98765 43210", "98765-43210", "0091 9876543210", "(+91) 98765-43210"]) {
      expect(isValidIndianMobile(ok)).toBe(true);
    }
    for (const bad of ["abcdefghij", "5876543210", "987654321", "98765432100", "+19876543210"]) {
      expect(isValidIndianMobile(bad)).toBe(false);
    }
    expect(normaliseIndianMobile("+91 9876543210")).toBe("9876543210");
    expect(normaliseIndianMobile("abc")).toBeNull();
    expect(normaliseIndianMobile("0091 98765-43210")).toBe("9876543210");
  });
  it("zIndianMobile stores ONE format (bare 10 digits) whatever the spelling", () => {
    for (const raw of ["+91 98765 43210", "98765-43210", "0091 9876543210", "919876543210"]) {
      expect(zIndianMobile.parse(raw)).toBe("9876543210");
    }
  });
  it("zTrimmedText treats a zero-width-only value as blank but keeps ZWJ/ZWNJ inside real words", () => {
    const s = zTrimmedText(50, { label: "name" });
    expect(s.safeParse("\u200B\u200B").success).toBe(false);
    expect(s.safeParse("\uFEFF").success).toBe(false);
    expect(s.safeParse("क\u200Dष").success).toBe(true);
  });
  it("age bounds are configurable (NAPS apprentices from 14)", () => {
    expect(checkAgeAtJoining("2010-01-01", "2024-06-01")).not.toBeNull();
    expect(ageAtJoiningBounds({ MIN_AGE_AT_JOINING: "14", MAX_AGE_AT_JOINING: "75" } as NodeJS.ProcessEnv)).toEqual({ min: 14, max: 75 });
    expect(checkAgeAtJoining("2010-01-01", "2024-06-01", 14, 70)).toBeNull();
  });
});

describe("GSTIN (TE-05)", () => {
  it("mod-36 check character vectors", () => {
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
    expect(gstinCheckChar("29AAGCB7383J1Z")).toBe("4");
    expect(gstinCheckChar("07AAACR5055K1Z")).toBe("9");
    expect(gstinCheckChar("27AAPFU0939F1")).toBeNull();
  });
  it.each(["27AAPFU0939F1ZV", "29AAGCB7383J1Z4", "07AAACR5055K1Z9", "97AAPFU0939F1ZO", " 27aapfu0939f1zv "])("accepts %s", (g) => {
    expect(isValidGstin(g)).toBe(true);
  });
  it.each([
    "27AAPFU0939F1ZX", // the T-EDGE E15 value: bad check character
    "39AAPFU0939F1ZQ", // checksum right, state 39 does not exist
    "00AAPFU0939F1ZB", // state 00
    "27AAPF00939F1ZV", // PAN part malformed
    "27AAPFU0939F0ZV", // entity 0
    "27AAPFU0939F1YV", // 14th not Z
    "27AAPFU0939F1Z",
  ])("refuses %s", (g) => {
    expect(isValidGstin(g)).toBe(false);
  });
  it("state codes", () => {
    expect(isValidGstStateCode("01")).toBe(true);
    expect(isValidGstStateCode("38")).toBe(true);
    expect(isValidGstStateCode("97")).toBe(true);
    expect(isValidGstStateCode("39")).toBe(false);
    expect(isValidGstStateCode("1")).toBe(false);
  });
  it("zGstin upper-cases and codes the failure", () => {
    expect(zGstin.parse("27aapfu0939f1zv")).toBe("27AAPFU0939F1ZV");
    expect(codeOf(zGstin, "27AAPFU0939F1ZX")).toBe(FIELD_CODES.GSTIN_INVALID);
  });
});

describe("money bounds", () => {
  it("default ceiling is 10^15 paise and configurable", () => {
    const prev = process.env.MONEY_MAX_MINOR;
    try {
      delete process.env.MONEY_MAX_MINOR;
      expect(moneyMaxMinor()).toBe(1_000_000_000_000_000n);
      process.env.MONEY_MAX_MINOR = "500";
      expect(moneyMaxMinor()).toBe(500n);
      process.env.MONEY_MAX_MINOR = (BIGINT_MAX + 1n).toString();
      expect(moneyMaxMinor()).toBe(1_000_000_000_000_000n);
    } finally {
      if (prev === undefined) delete process.env.MONEY_MAX_MINOR;
      else process.env.MONEY_MAX_MINOR = prev;
    }
  });
  it("refuses beyond-bigint and over-ceiling amounts", () => {
    expect(checkMoneyBound(10n ** 19n)?.code).toBe(FIELD_CODES.AMOUNT_TOO_LARGE);
    expect(checkMoneyBound(100n)).toBeNull();
    const s = z.number().int().superRefine(boundedMinorNumber);
    expect(codeOf(s, 1e19)).toBe(FIELD_CODES.AMOUNT_TOO_LARGE);
    expect(codeOf(s, 9007199254740993)).toBe(FIELD_CODES.AMOUNT_TOO_LARGE);
    expect(s.parse(80000)).toBe(80000);
  });
});

describe("financial year label", () => {
  it.each(["2026-27", "1999-00", "2099-00"])("accepts %s", (fy) => expect(isValidFyLabel(fy)).toBe(true));
  it.each(["2031-99", "2026-26", "2026-28", "31-32", "2026-2027", "1949-50"])("refuses %s", (fy) => expect(isValidFyLabel(fy)).toBe(false));
  it("zFyLabel codes FY_INVALID", () => {
    expect(codeOf(zFyLabel, "2031-99")).toBe(FIELD_CODES.FY_INVALID);
  });
});
