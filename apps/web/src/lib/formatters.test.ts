import { describe, it, expect, vi, afterEach } from "vitest";
import { formatMoneyCompact, formatMoney, formatCrore, formatIndianDate, formatIndianDateTime, todayIST, istDatePart, addDaysIST, minorToRupeesOrNull, formatClockTime12h, percentOfMinor, humanizeStatus, formatEntityRef, utilisationPercent, isOverUtilised } from "./formatters";

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
// formatCrore -- GAP-PROJECTS-DASHBOARD-02: paise -> "₹X.XX Cr", BigInt-based.
// ---------------------------------------------------------------------------
describe("formatCrore", () => {
  it("renders a sub-crore outlay with 2 decimals instead of rounding to ₹0 Cr", () => {
    expect(formatCrore(400_000_000)).toBe("₹0.40 Cr"); // ₹0.4 Cr
  });
  it("renders a zero outlay as ₹0.00 Cr", () => {
    expect(formatCrore(0)).toBe("₹0.00 Cr");
  });
  it("renders a multi-crore outlay with Indian grouping", () => {
    expect(formatCrore(1_800_000_000)).toBe("₹1.80 Cr");
  });
  it("stays exact for paise values above 2^53", () => {
    // 1e16 paise = 1e7 crore = 1,00,00,000 Cr; Number math would drift here.
    expect(formatCrore("10000000000000000")).toBe("₹1,00,00,000.00 Cr");
  });
  it("returns — for missing / unparseable input", () => {
    expect(formatCrore(null)).toBe("—");
    expect(formatCrore(undefined)).toBe("—");
    expect(formatCrore("garbage")).toBe("—");
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

// vi/afterEach already imported at the top of this file (added independently
// by GAP-HR-SF-07's date-format PR, which landed on main after this block was
// written) -- only the new symbol this block actually needs goes here.
import { daysUntilIST } from "./formatters";
describe("daysUntilIST (GAP-HR-CONFIRMATION-06: calendar-day diff, Asia/Kolkata)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for a missing or unparseable date", () => {
    expect(daysUntilIST(null)).toBeNull();
    expect(daysUntilIST(undefined)).toBeNull();
    expect(daysUntilIST("not-a-date")).toBeNull();
  });

  it("a bare calendar-date string is compared literally, no timezone shift", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T10:00:00.000Z")); // 15:30 IST, same calendar day
    expect(daysUntilIST("2026-03-01")).toBe(0);
    expect(daysUntilIST("2026-03-02")).toBe(1);
    expect(daysUntilIST("2026-02-28")).toBe(-1);
  });

  it("at 2026-03-01T19:00Z (00:30 IST on 2026-03-02), a dueDate of 2026-03-01 is one day overdue", () => {
    // The exact scenario GAP-HR-CONFIRMATION-06's acceptance criteria names:
    // a UTC-string compare of dueDate against a UTC "today" would say this
    // dueDate is NOT overdue yet (both still read "2026-03-01" in UTC);
    // the real IST wall-clock day has already moved to 2026-03-02.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T19:00:00.000Z"));
    expect(daysUntilIST("2026-03-01")).toBe(-1);
  });

  it("a full ISO timestamp is resolved to its Asia/Kolkata calendar day first", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T10:00:00.000Z"));
    // 2026-01-15T19:00Z is 00:30 IST on 2026-01-16.
    expect(daysUntilIST("2026-01-15T19:00:00.000Z")).toBe(daysUntilIST("2026-01-16"));
  });
});

import { formatPeriod } from "./formatters";

describe("formatPeriod (GAP-PAYROLL-ARREARS-06)", () => {
  it("formats YYYY-MM as 'Mon YYYY'", () => {
    expect(formatPeriod("2026-07")).toBe("Jul 2026");
    expect(formatPeriod("2025-12")).toBe("Dec 2025");
  });
  it("renders missing as an em dash and passes unparseable values through", () => {
    expect(formatPeriod(null)).toBe("—");
    expect(formatPeriod("")).toBe("—");
    expect(formatPeriod("2026-13")).toBe("2026-13");
    expect(formatPeriod("July")).toBe("July");
  });
});

describe("formatMoneyCompact (GAP-FINANCE-BUDGET-ALLOCATION-05)", () => {
  it("renders Cr / L with bigint maths", () => {
    // 1 crore rupees = 1,000,000,000 paise; 1 lakh rupees = 10,000,000 paise.
    expect(formatMoneyCompact(1800000000n)).toBe("₹1.80 Cr");
    expect(formatMoneyCompact(18000000000n)).toBe("₹18.00 Cr");
    expect(formatMoneyCompact(530000000n)).toBe("₹53.00 L");
    expect(formatMoneyCompact(12345000n)).toBe("₹1.23 L");
    expect(formatMoneyCompact("-5300000000")).toBe("-₹5.30 Cr");
  });
  it("keeps exact paise below 1 lakh and shows missing as a dash", () => {
    expect(formatMoneyCompact(1234500n)).toBe("₹12,345.00");
    expect(formatMoneyCompact(9999999n)).toBe("₹99,999.99");
    expect(formatMoneyCompact(null)).toBe("—");
  });
  it("is exact beyond 2^53 and rolls 99.995 L up to 1 Cr, not '100.00 L'", () => {
    expect(formatMoneyCompact(9007199254740993000n)).toBe("₹9007199254.74 Cr");
    expect(formatMoneyCompact(999950000n)).toBe("₹1.00 Cr");
  });
});

describe("percentOfMinor (GAP-FINANCE-EXPENDITURE-SCHEME-TRACKING-DETAIL-02)", () => {
  it("computes whole percentages, flagging over-utilisation as >100", () => {
    expect(percentOfMinor("120", "100")).toBe(120);
    expect(percentOfMinor(50n, 200n)).toBe(25);
    expect(percentOfMinor("1", "3")).toBe(33);
    expect(percentOfMinor("2", "3")).toBe(67);
  });
  it("is null (render an em dash) when there is no positive outlay", () => {
    expect(percentOfMinor("1", "0")).toBeNull();
    expect(percentOfMinor("0", "0")).toBeNull();
    expect(percentOfMinor("5", null)).toBeNull();
    expect(percentOfMinor("abc", "10")).toBeNull();
  });
  it("is exact above 2^53 paise (no Number() precision loss)", () => {
    expect(percentOfMinor("9007199254740993", "9007199254740993")).toBe(100);
    expect(percentOfMinor("18014398509481986", "9007199254740993")).toBe(200);
    expect(percentOfMinor("9007199254740992", "9007199254740993")).toBe(100);
  });
});

describe("humanizeStatus guarantee types (GAP-FINANCE-EXPENDITURE-GUARANTEES-05)", () => {
  it("renders acronyms and snake_case types", () => {
    expect(humanizeStatus("emd")).toBe("EMD");
    expect(humanizeStatus("bg")).toBe("BG");
    expect(humanizeStatus("pbg")).toBe("PBG");
    expect(humanizeStatus("performance")).toBe("Performance");
    expect(humanizeStatus("partially_released")).toBe("Partially Released");
  });
});

describe("formatEntityRef (GAP-FINANCE-EXPENDITURE-BILLS-06)", () => {
  it("drops the type prefix and shortens a raw UUID", () => {
    expect(formatEntityRef("procurement_po:5b1c2d3e-0000-4000-8000-000000000000")).toBe("PO 5b1c2d3e");
    expect(formatEntityRef("procurement_grn:5b1c2d3e-0000-4000-8000-000000000000")).toBe("GRN 5b1c2d3e");
  });
  it("shows a human number as-is and a missing ref as an em dash", () => {
    expect(formatEntityRef("procurement_po:PO-2026-014")).toBe("PO-2026-014");
    expect(formatEntityRef("PO-9")).toBe("PO-9");
    expect(formatEntityRef(null)).toBe("—");
    expect(formatEntityRef("procurement_po:undefined")).toBe("—");
    expect(formatEntityRef("procurement_po:")).toBe("—");
  });
});

describe("utilisationPercent / isOverUtilised (exact over-utilisation)", () => {
  it("keeps one decimal so 100.3% is not rounded to 100%", () => {
    expect(utilisationPercent("1003", "1000")).toBe(100.3);
    expect(utilisationPercent("400", "1000")).toBe(40);
    expect(utilisationPercent("1", "0")).toBeNull();
  });
  it("flags on the exact BigInt comparison, not the rounded percentage", () => {
    expect(isOverUtilised("1003", "1000")).toBe(true);
    // 100.04% rounds to 100.0 but is still over.
    expect(isOverUtilised("10004", "10000")).toBe(true);
    expect(isOverUtilised("1000", "1000")).toBe(false);
    expect(isOverUtilised("999", "1000")).toBe(false);
    expect(isOverUtilised("5", "0")).toBe(false);
    expect(isOverUtilised("9007199254740994", "9007199254740993")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// istDatePart + todayIST at the IST day boundary -- GAP-CRM-ACTIVITIES-03
// ---------------------------------------------------------------------------
describe("istDatePart (GAP-CRM-ACTIVITIES-03)", () => {
  it("returns a bare calendar date unchanged", () => {
    expect(istDatePart("2026-03-11")).toBe("2026-03-11");
  });

  it("resolves a UTC instant to its IST calendar day", () => {
    // 2026-03-10T19:00:00Z == 2026-03-11 00:30 IST.
    expect(istDatePart("2026-03-10T19:00:00.000Z")).toBe("2026-03-11");
  });

  it("returns null for empty/invalid input", () => {
    expect(istDatePart(null)).toBeNull();
    expect(istDatePart(undefined)).toBeNull();
    expect(istDatePart("not a date")).toBeNull();
  });
});

describe("todayIST at the IST day boundary (GAP-CRM-ACTIVITIES-03)", () => {
  afterEach(() => vi.useRealTimers());

  it("returns the IST day, not the UTC day, just after IST midnight", () => {
    vi.useFakeTimers();
    // 00:30 IST on 11 Mar 2026 is still 10 Mar in UTC.
    vi.setSystemTime(new Date("2026-03-10T19:00:00.000Z"));
    expect(todayIST()).toBe("2026-03-11");
  });
});
