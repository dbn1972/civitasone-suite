import { describe, it, expect } from "vitest";
import { isMandatory, daysUntilExpiry, deriveCardStatus } from "./certifications";

// ---------------------------------------------------------------------------
// isMandatory -- GAP-HR-CERTIFICATIONS-06: word-boundary matching, not substring
// ---------------------------------------------------------------------------
describe("isMandatory", () => {
  it("does NOT flag 'Certified Ethical Hacker' (previously false-positived via 'rti' substring)", () => {
    expect(isMandatory("Certified Ethical Hacker")).toBe(false);
  });

  it("flags 'RTI Act Awareness' as mandatory (standalone word)", () => {
    expect(isMandatory("RTI Act Awareness")).toBe(true);
  });

  it("does NOT flag 'Partial Differential Equations' (previously false-positived via 'rti' substring)", () => {
    expect(isMandatory("Partial Differential Equations")).toBe(false);
  });

  it("does NOT flag 'Conducted Leadership Workshop' (previously false-positived via 'conduct' substring)", () => {
    expect(isMandatory("Conducted Leadership Workshop")).toBe(false);
  });

  it("flags 'Conduct Rules Training' as mandatory (standalone word)", () => {
    expect(isMandatory("Conduct Rules Training")).toBe(true);
  });

  it("flags 'DoPT Circular on Leave Rules' as mandatory (case-insensitive)", () => {
    expect(isMandatory("DoPT Circular on Leave Rules")).toBe(true);
  });

  it("flags phrases with internal spaces ('Data Protection Fundamentals')", () => {
    expect(isMandatory("Data Protection Fundamentals")).toBe(true);
  });

  it("flags 'Cyber Security Awareness Programme'", () => {
    expect(isMandatory("Cyber Security Awareness Programme")).toBe(true);
  });

  it("flags 'Central Civil Service Rules Orientation' (service rules)", () => {
    expect(isMandatory("Central Civil Service Rules Orientation")).toBe(true);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isMandatory(null)).toBe(false);
    expect(isMandatory(undefined)).toBe(false);
    expect(isMandatory("")).toBe(false);
  });

  it("does not flag an unrelated technical certification", () => {
    expect(isMandatory("AWS Certified Solutions Architect")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// daysUntilExpiry -- deterministic via injectable `now`
// ---------------------------------------------------------------------------
describe("daysUntilExpiry", () => {
  const now = new Date("2026-10-01T12:00:00.000Z"); // mid-day shouldn't matter

  it("computes +30 days", () => {
    expect(daysUntilExpiry("2026-10-31", now)).toBe(30);
  });

  it("computes -1 day (yesterday)", () => {
    expect(daysUntilExpiry("2026-09-30", now)).toBe(-1);
  });

  it("computes 0 for today", () => {
    expect(daysUntilExpiry("2026-10-01", now)).toBe(0);
  });

  it("handles a full ISO timestamp input the same as its bare date part", () => {
    expect(daysUntilExpiry("2026-10-31T00:00:00.000Z", now)).toBe(30);
  });

  it("is unaffected by time-of-day on `now`, as long as both instants fall in the same IST calendar day", () => {
    const earlyMorning = new Date("2026-10-01T00:05:00.000Z"); // 05:35 IST, 1 Oct
    const lateEvening = new Date("2026-10-01T18:00:00.000Z"); // 23:30 IST, still 1 Oct -- IST day rolls over at 18:30 UTC
    expect(daysUntilExpiry("2026-10-31", earlyMorning)).toBe(30);
    expect(daysUntilExpiry("2026-10-31", lateEvening)).toBe(30);
  });

  // ---------------------------------------------------------------------
  // Regression: IST/UTC day-boundary bug (reviewer-found on PR #1736).
  //
  // daysUntilExpiry's `now` side used to read its calendar day via plain
  // getUTCFullYear/Month/Date(), with no IST shift -- unlike
  // formatters.ts's daysUntilIST, which shifts BOTH sides by IST_OFFSET_MS
  // before comparing. For any `now` between 18:30 and 23:59:59 UTC (already
  // past midnight, into the next calendar day, in IST), that made this
  // function read one day further BEHIND than the real IST calendar day,
  // understating how overdue/expired a certification is.
  //
  // This was never caught by the test above because its "lateNight" probe
  // (23:55 UTC) happened to fall inside that same window without anyone
  // noticing the IST date had already rolled over -- it asserted the
  // pre-fix (wrong) answer as if it were an invariant.
  // ---------------------------------------------------------------------
  it("GAP-HR-CERTIFICATIONS regression: a `now` of 19:00 UTC (00:30 IST next day) reads one day further along than its UTC calendar date would suggest", () => {
    const now = new Date("2026-10-01T19:00:00.000Z");
    expect(daysUntilExpiry("2026-10-01", now)).toBe(-1);
  });

  it("GAP-HR-CERTIFICATIONS regression: just before the IST rollover (18:29 UTC), the UTC calendar day still applies", () => {
    const now = new Date("2026-10-01T18:29:00.000Z");
    expect(daysUntilExpiry("2026-10-01", now)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deriveCardStatus -- GAP-HR-CERTIFICATIONS-01/06 acceptance criteria
// ---------------------------------------------------------------------------
describe("deriveCardStatus", () => {
  const now = new Date("2026-10-01T00:00:00.000Z");

  it("returns 'no_expiry' for null (no validity tracked) -- not 'valid', not 'expired'", () => {
    expect(deriveCardStatus(null, now)).toBe("no_expiry");
  });

  it("returns 'no_expiry' for undefined", () => {
    expect(deriveCardStatus(undefined, now)).toBe("no_expiry");
  });

  it("today+30 => 'expiring_soon'", () => {
    expect(deriveCardStatus("2026-10-31", now)).toBe("expiring_soon");
  });

  it("today-1 => 'expired'", () => {
    expect(deriveCardStatus("2026-09-30", now)).toBe("expired");
  });

  it("today+31 => 'valid' (just outside the 30-day window)", () => {
    expect(deriveCardStatus("2026-11-01", now)).toBe("valid");
  });

  it("today => 'expiring_soon' (0 days left counts as soon, not valid)", () => {
    expect(deriveCardStatus("2026-10-01", now)).toBe("expiring_soon");
  });

  it("GAP-HR-CERTIFICATIONS regression: at 00:30 IST the next day (19:00 UTC), a cert expiring 'today' (UTC-wise) is already 'expired', not 'expiring_soon'", () => {
    const pastIstRollover = new Date("2026-10-01T19:00:00.000Z");
    expect(deriveCardStatus("2026-10-01", pastIstRollover)).toBe("expired");
  });
});
