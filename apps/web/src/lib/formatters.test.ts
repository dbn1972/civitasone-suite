import { describe, it, expect, vi, afterEach } from "vitest";
import { formatMoney, formatIndianDate, formatIndianDateTime, todayIST, addDaysIST, minorToRupeesOrNull, formatClockTime12h } from "./formatters";

// ---------------------------------------------------------------------------
// formatClockTime12h -- GAP-HR-ATTENDANCE-CONFIG-02
// ---------------------------------------------------------------------------
describe("formatClockTime12h", () => {
  it("formats a morning time", () => {
    expect(formatClockTime12h("09:30")).toBe("09:30 AM");
  });

  it("formats an afternoon/evening time (hour > 12)", () => {
    expect(formatClockTime12h("18:00")).toBe("06:00 PM");
  });

  it("formats noon as 12 PM", () => {
    expect(formatClockTime12h("12:30")).toBe("12:30 PM");
  });

  it("formats midnight as 12 AM", () => {
    expect(formatClockTime12h("00:05")).toBe("12:05 AM");
  });

  it("passes through unparseable input rather than hiding it", () => {
    expect(formatClockTime12h("not-a-time")).toBe("not-a-time");
  });
});

// ---------------------------------------------------------------------------
// formatMoney -- converts minor units (paise) to INR string with Indian grouping
// ---------------------------------------------------------------------------
describe("formatMoney", () => {
  it("formats paise as rupees with 2 decimal places", () => {
    expect(formatMoney(100)).toBe("₹1.00");
  });

  it("applies Indian lakh/crore grouping", () => {
    // 123456789 paise = INR 12,34,567.89
    expect(formatMoney(123456789n)).toBe("₹12,34,567.89");
  });

  it("handles zero", () => {
    expect(formatMoney(0)).toBe("₹0.00");
  });

  it("handles negative minor units", () => {
    expect(formatMoney(-2550)).toBe("-₹25.50");
  });

  it("accepts bigint input", () => {
    expect(formatMoney(100n)).toBe("₹1.00");
  });

  it("accepts numeric string input", () => {
    expect(formatMoney("2550")).toBe("₹25.50");
  });

  it("accepts negative numeric string", () => {
    expect(formatMoney("-2550")).toBe("-₹25.50");
  });

  it("returns an em-dash for invalid input, never a fabricated ₹0.00 (UX-006)", () => {
    expect(formatMoney("not-a-number")).toBe("—");
  });

  // ---------------------------------------------------------------------------
  // UX-006: missing money must render as an honest "—", never as ₹0.00 --
  // a real zero amount and a missing/error value must stay visually distinct.
  // ---------------------------------------------------------------------------
  it("returns an em-dash for null (UX-006: missing, not zero)", () => {
    expect(formatMoney(null)).toBe("—");
  });

  it("returns an em-dash for undefined (UX-006: missing, not zero)", () => {
    expect(formatMoney(undefined)).toBe("—");
  });

  it("returns an em-dash for an empty string (UX-006: missing, not zero)", () => {
    expect(formatMoney("")).toBe("—");
  });

  it("returns an em-dash for non-finite numeric input (UX-006: missing, not zero)", () => {
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("keeps a genuine zero amount as ₹0.00, distinct from missing data", () => {
    expect(formatMoney(0)).toBe("₹0.00");
    expect(formatMoney(0)).not.toBe(formatMoney(null));
    expect(formatMoney(0)).not.toBe(formatMoney(undefined));
  });

  it("pads single-digit paise with leading zero", () => {
    // 101 paise = INR 1.01
    expect(formatMoney(101)).toBe("₹1.01");
  });

  it("formats large amount in crore range", () => {
    // 1000000000 paise = INR 1,00,00,000.00
    expect(formatMoney(1000000000n)).toBe("₹1,00,00,000.00");
  });
});

// ---------------------------------------------------------------------------
// formatIndianDate -- formats dates as "dd Mon yyyy" (SF-07 date-format
// standard, e.g. "28 Sep 2026"; previously dd/MM/yyyy). A bare "YYYY-MM-DD"
// calendar-date string is formatted literally (no timezone to convert); a
// full ISO timestamp is resolved to its Asia/Kolkata calendar day first.
// ---------------------------------------------------------------------------
describe("formatIndianDate", () => {
  it("formats a bare calendar-date string (no time component) literally", () => {
    expect(formatIndianDate("2024-01-15")).toBe("15 Jan 2024");
  });

  it("formats the exact new dd Mon yyyy string, not just a loose pattern", () => {
    expect(formatIndianDate("2024-03-31")).toBe("31 Mar 2024");
  });

  it("converts a full ISO timestamp to its Asia/Kolkata calendar day across a UTC day boundary", () => {
    // 19:00 UTC on Jan 15 is 00:30 IST on Jan 16 -- a bare .slice(0, 10) or a
    // timeZone-less toLocaleDateString would wrongly show Jan 15.
    expect(formatIndianDate("2024-01-15T19:00:00.000Z")).toBe("16 Jan 2024");
  });

  it("does not roll a timestamp forward when UTC and IST already agree on the calendar day", () => {
    expect(formatIndianDate("2024-01-15T05:00:00.000Z")).toBe("15 Jan 2024");
  });

  it("returns em-dash for null", () => {
    expect(formatIndianDate(null)).toBe("—");
  });

  it("returns em-dash for undefined", () => {
    expect(formatIndianDate(undefined)).toBe("—");
  });

  it("returns em-dash for empty string", () => {
    expect(formatIndianDate("")).toBe("—");
  });

  it("returns original string for unparseable date", () => {
    const bad = "not-a-date";
    expect(formatIndianDate(bad)).toBe(bad);
  });

  it("formats Republic Day correctly", () => {
    expect(formatIndianDate("2024-01-26")).toBe("26 Jan 2024");
  });

  it("formats fiscal year end correctly", () => {
    expect(formatIndianDate("2024-03-31")).toBe("31 Mar 2024");
  });

  it("renders September as the 3-letter \"Sep\", not CLDR's 4-letter \"Sept\"", () => {
    // toLocaleDateString(..., { month: "short" }) renders September as
    // "Sept" under recent CLDR English data, which would make this format
    // inconsistently 3-or-4 letters depending on the month; formatIndianDate
    // must use its own fixed month table instead, not the locale default.
    expect(formatIndianDate("2026-09-29")).toBe("29 Sep 2026");
  });

  it("renders every month as exactly a 3-letter abbreviation", () => {
    const expected = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (let m = 0; m < 12; m++) {
      const mm = String(m + 1).padStart(2, "0");
      expect(formatIndianDate(`2026-${mm}-05`)).toBe(`05 ${expected[m]} 2026`);
    }
  });
});

// ---------------------------------------------------------------------------
// formatIndianDateTime -- "dd Mon yyyy, hh:mm am/pm", always Asia/Kolkata
// (a date+time value is always a real instant, so there is no bare-date case).
// ---------------------------------------------------------------------------
describe("formatIndianDateTime", () => {
  it("formats the exact new date+time string", () => {
    // 19:00 UTC -> 00:30 IST the next calendar day.
    expect(formatIndianDateTime("2024-01-15T19:00:00.000Z")).toBe("16 Jan 2024, 12:30 am");
  });

  it("accepts a Date instance as well as an ISO string", () => {
    const d = new Date("2024-01-15T19:00:00.000Z");
    expect(formatIndianDateTime(d)).toBe(formatIndianDateTime("2024-01-15T19:00:00.000Z"));
  });

  it("returns em-dash for null/undefined", () => {
    expect(formatIndianDateTime(null)).toBe("—");
    expect(formatIndianDateTime(undefined)).toBe("—");
  });

  it("returns the original string for an unparseable value", () => {
    expect(formatIndianDateTime("not-a-date")).toBe("not-a-date");
  });
});

// ---------------------------------------------------------------------------
// todayIST -- today's Asia/Kolkata calendar date as "YYYY-MM-DD", matching
// the date-only shape existing overdue/min-max date-input checks already
// compare against (e.g. hr/onboarding/[id]/page.tsx's due-date check).
// ---------------------------------------------------------------------------
describe("todayIST", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the exact YYYY-MM-DD shape", () => {
    expect(todayIST()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("resolves via Asia/Kolkata, not the process's local/UTC day, near a day boundary", () => {
    // 19:00 UTC on Jan 15 is already Jan 16 in IST.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T19:00:00.000Z"));
    expect(todayIST()).toBe("2024-01-16");
  });
});

// ---------------------------------------------------------------------------
// addDaysIST -- IST-aware calendar-day arithmetic; "YYYY-MM-DD" in (bare
// string, ISO timestamp, or Date), same "YYYY-MM-DD" shape out, so it
// composes with todayIST() (e.g. a form's max date: addDaysIST(todayIST(), 30)).
// ---------------------------------------------------------------------------
describe("addDaysIST", () => {
  it("adds days to a bare calendar-date string", () => {
    expect(addDaysIST("2026-09-29", 7)).toBe("2026-10-06");
  });

  it("subtracts days with a negative count", () => {
    expect(addDaysIST("2026-09-29", -7)).toBe("2026-09-22");
  });

  it("resolves a full ISO timestamp to its IST calendar day before adding", () => {
    // 19:00 UTC Jan 15 = 00:30 IST Jan 16; +1 day = Jan 17.
    expect(addDaysIST("2024-01-15T19:00:00.000Z", 1)).toBe("2024-01-17");
  });

  it("rolls over a month/year boundary correctly", () => {
    expect(addDaysIST("2026-12-30", 5)).toBe("2027-01-04");
  });

  it("returns em-dash for null/undefined, matching this file's UX-006 convention", () => {
    expect(addDaysIST(null, 7)).toBe("—");
    expect(addDaysIST(undefined, 7)).toBe("—");
  });
});

import { formatRupees } from "./formatters";
describe("formatRupees (input already in rupees)", () => {
  it("formats a rupee value without dividing by 100", () => {
    expect(formatRupees(90000)).toBe("₹90,000.00");
    expect(formatRupees(90000)).not.toBe("₹900.00");
  });
  it("handles string input safely", () => {
    expect(formatRupees("1234.5")).toBe("₹1,234.50");
  });

  it("returns an em-dash for non-finite/missing input, never a fabricated ₹0.00 (UX-006)", () => {
    expect(formatRupees(Number.NaN)).toBe("—");
    expect(formatRupees(null)).toBe("—");
    expect(formatRupees(undefined)).toBe("—");
    expect(formatRupees("")).toBe("—");
  });

  it("keeps a genuine zero amount as ₹0.00, distinct from missing data", () => {
    expect(formatRupees(0)).toBe("₹0.00");
    expect(formatRupees(0)).not.toBe(formatRupees(null));
  });
});

describe("minorToRupeesOrNull (UX-006 type guard for arithmetic on *Minor fields)", () => {
  it("converts minor units to a rupee number", () => {
    expect(minorToRupeesOrNull(12345)).toBeCloseTo(123.45);
    expect(minorToRupeesOrNull("90000")).toBeCloseTo(900);
    expect(minorToRupeesOrNull(100n)).toBeCloseTo(1);
  });

  it("returns null for missing/invalid input instead of a fabricated 0", () => {
    expect(minorToRupeesOrNull(null)).toBeNull();
    expect(minorToRupeesOrNull(undefined)).toBeNull();
    expect(minorToRupeesOrNull("")).toBeNull();
    expect(minorToRupeesOrNull("garbage")).toBeNull();
    expect(minorToRupeesOrNull(Number.NaN)).toBeNull();
  });

  it("distinguishes a genuine zero from missing data", () => {
    expect(minorToRupeesOrNull(0)).toBe(0);
    expect(minorToRupeesOrNull(0)).not.toBeNull();
  });
});

import { formatBps } from "./formatters";
describe("formatBps (basis points -> percent, no premature rounding)", () => {
  it("strips trailing zeros", () => {
    expect(formatBps(1200)).toBe("12%");
    expect(formatBps(10000)).toBe("100%");
  });
  it("keeps a meaningful fraction", () => {
    expect(formatBps(550)).toBe("5.5%");
    expect(formatBps(12)).toBe("0.12%");
    expect(formatBps(1)).toBe("0.01%");
  });
  it("accepts numeric strings", () => {
    expect(formatBps("1200")).toBe("12%");
  });
  it("returns an em-dash for null/undefined/invalid", () => {
    expect(formatBps(null)).toBe("—");
    expect(formatBps(undefined)).toBe("—");
    expect(formatBps("abc")).toBe("—");
  });
});

import { formatPercent } from "./formatters";
describe("formatPercent (already-computed 0-100 percentage, e.g. Budget Utilisation)", () => {
  it("formats to one decimal place by default", () => {
    expect(formatPercent(45.2)).toBe("45.2%");
    expect(formatPercent(100)).toBe("100.0%");
  });

  it("keeps a genuine 0% distinct from missing data", () => {
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(0)).not.toBe(formatPercent(null));
  });

  it("returns an em-dash for null (UX-006: no sanctioned budget on record, not a real 0%)", () => {
    expect(formatPercent(null)).toBe("—");
  });

  it("returns an em-dash for undefined/non-finite input", () => {
    expect(formatPercent(undefined)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("respects a custom decimals count", () => {
    expect(formatPercent(45.239, 2)).toBe("45.24%");
    expect(formatPercent(45, 0)).toBe("45%");
  });
});
