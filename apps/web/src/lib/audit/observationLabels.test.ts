import { describe, it, expect } from "vitest";
import {
  severityMeta,
  statusMeta,
  isOpen,
  isSettled,
  isUnderReply,
  inFiscalYear,
  fiscalYearBounds,
} from "./observationLabels";

describe("observationLabels severity", () => {
  it("maps each known severity to a capitalised label", () => {
    expect(severityMeta("critical")).toEqual({ label: "Critical", pill: "bad" });
    expect(severityMeta("major")).toEqual({ label: "High", pill: "bad" });
    expect(severityMeta("minor")).toEqual({ label: "Medium", pill: "warn" });
    expect(severityMeta("observation")).toEqual({ label: "Low", pill: "mut" });
  });

  it("does NOT collapse 'high' to Low — renders raw text in a neutral pill", () => {
    // The old riskPill rendered anything unknown (incl. 'high') as 'Low'.
    const m = severityMeta("high");
    expect(m.label).toBe("high");
    expect(m.pill).toBe("mut");
    expect(m.label).not.toBe("Low");
  });
});

describe("observationLabels status", () => {
  it("maps known statuses", () => {
    expect(statusMeta("open").label).toBe("Open");
    expect(statusMeta("closed")).toEqual({ label: "Settled", pill: "good" });
    expect(statusMeta("compliance_pending").label).toBe("Compliance pending");
  });

  it("renders an unknown status as raw text neutral pill, not blank", () => {
    const m = statusMeta("on_hold");
    expect(m.label).toBe("on_hold");
    expect(m.pill).toBe("mut");
  });
});

describe("lifecycle predicates", () => {
  it("isOpen is everything except closed", () => {
    expect(isOpen("open")).toBe(true);
    expect(isOpen("replied")).toBe(true);
    expect(isOpen("compliance_pending")).toBe(true);
    expect(isOpen("partially_closed")).toBe(true);
    expect(isOpen("closed")).toBe(false);
  });
  it("isSettled only for closed", () => {
    expect(isSettled("closed")).toBe(true);
    expect(isSettled("open")).toBe(false);
  });
  it("isUnderReply covers the reply/review loop", () => {
    expect(isUnderReply("replied")).toBe(true);
    expect(isUnderReply("compliance_pending")).toBe(true);
    expect(isUnderReply("partially_closed")).toBe(true);
    expect(isUnderReply("open")).toBe(false);
    expect(isUnderReply("closed")).toBe(false);
  });
});

describe("fiscal year (1 Apr – 31 Mar)", () => {
  const ref = new Date(Date.UTC(2026, 5, 15)); // 15 Jun 2026 → FY 2026-04-01..2027-04-01
  it("computes the FY window containing June", () => {
    const { start, end } = fiscalYearBounds(ref);
    expect(start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-04-01T00:00:00.000Z");
  });
  it("Jan–Mar belong to the previous FY start-year", () => {
    const { start } = fiscalYearBounds(new Date(Date.UTC(2026, 1, 10))); // Feb 2026
    expect(start.toISOString()).toBe("2025-04-01T00:00:00.000Z");
  });
  it("inFiscalYear includes a date within and excludes one outside", () => {
    expect(inFiscalYear("2026-05-01", ref)).toBe(true);
    expect(inFiscalYear("2027-05-01", ref)).toBe(false);
    expect(inFiscalYear("2026-03-31", ref)).toBe(false); // previous FY
  });
  it("inFiscalYear is false for null / malformed", () => {
    expect(inFiscalYear(null, ref)).toBe(false);
    expect(inFiscalYear("not-a-date", ref)).toBe(false);
  });
});
