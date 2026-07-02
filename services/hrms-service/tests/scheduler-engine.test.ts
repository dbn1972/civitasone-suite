/**
 * Coverage tests for scheduler/engine.ts (7.52% → target: 100%).
 * Pure date computation — no DB or I/O.
 */
import { describe, it, expect } from "vitest";
import {
  daysBetween,
  superannuationDate,
  addMonths,
  computeSuperannuationDue,
  computeProbationDue,
  DEFAULT_SUPERANNUATION_AGE,
  DEFAULT_PROBATION_MONTHS,
} from "../src/modules/scheduler/engine.js";

describe("scheduler/engine — daysBetween()", () => {
  it("returns 0 for same date", () => {
    expect(daysBetween("2025-06-01", "2025-06-01")).toBe(0);
  });

  it("returns positive for future date", () => {
    expect(daysBetween("2025-06-01", "2025-06-11")).toBe(10);
  });

  it("returns negative for past date", () => {
    expect(daysBetween("2025-06-11", "2025-06-01")).toBe(-10);
  });

  it("handles month boundaries", () => {
    expect(daysBetween("2025-01-31", "2025-02-01")).toBe(1);
  });

  it("handles year boundaries", () => {
    expect(daysBetween("2024-12-31", "2025-01-01")).toBe(1);
  });
});

describe("scheduler/engine — superannuationDate()", () => {
  it("birth mid-month: retire last day of birth month + age years", () => {
    // Born 15 Jun 1965 → retires last day of Jun 2025 (60th birthday month)
    expect(superannuationDate("1965-06-15")).toBe("2025-06-30");
  });

  it("born on 1st: retire last day of PREVIOUS month", () => {
    // Born 1 Jul 1965 → retires last day of Jun 2025
    expect(superannuationDate("1965-07-01")).toBe("2025-06-30");
  });

  it("born on 1 Jan: retire last day of Dec of previous year", () => {
    // Born 1 Jan 1965 → retires 31 Dec 2024
    expect(superannuationDate("1965-01-01")).toBe("2024-12-31");
  });

  it("handles February (non-leap year)", () => {
    // Born 15 Feb 1965 → retires 28 Feb 2025
    expect(superannuationDate("1965-02-15")).toBe("2025-02-28");
  });

  it("handles February (leap year)", () => {
    // Born 15 Feb 1964 → retires 29 Feb 2024
    expect(superannuationDate("1964-02-15")).toBe("2024-02-29");
  });

  it("supports custom retirement age", () => {
    // Born 15 Jun 1970, age 62 → retire Jun 2032
    expect(superannuationDate("1970-06-15", 62)).toBe("2032-06-30");
  });
});

describe("scheduler/engine — addMonths()", () => {
  it("adds months normally", () => {
    expect(addMonths("2025-01-15", 3)).toBe("2025-04-15");
  });

  it("wraps across year boundary", () => {
    expect(addMonths("2025-11-15", 3)).toBe("2026-02-15");
  });

  it("clamps day to month length (Jan 31 + 1 = Feb 28)", () => {
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
  });

  it("handles leap year (Jan 31 + 1 = Feb 29 in 2024)", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("adds 24 months (default probation)", () => {
    expect(addMonths("2024-01-15", 24)).toBe("2026-01-15");
  });
});

describe("scheduler/engine — computeSuperannuationDue()", () => {
  const candidates = [
    { employeeId: "e1", employeeNo: "EMP001", fullName: "Alice", dateOfBirthISO: "1965-06-15" },
    { employeeId: "e2", employeeNo: "EMP002", fullName: "Bob", dateOfBirthISO: "1970-03-10" },
    { employeeId: "e3", employeeNo: "EMP003", fullName: "Charlie", dateOfBirthISO: "1965-01-01" },
  ];

  it("filters candidates within the window", () => {
    // As of 2025-01-01, window 365 days
    const due = computeSuperannuationDue(candidates, "2025-01-01", 365);
    // Alice retires 2025-06-30 (180 days from Jan 1) — within window
    // Charlie retires 2024-12-31 (negative days, overdue) — within window
    // Bob retires 2030-03-31 — NOT within window
    expect(due.length).toBe(2);
    expect(due.find((d) => d.employeeId === "e1")).toBeDefined();
    expect(due.find((d) => d.employeeId === "e3")).toBeDefined();
  });

  it("sorts by daysRemaining ascending", () => {
    const due = computeSuperannuationDue(candidates, "2025-01-01", 365);
    for (let i = 1; i < due.length; i++) {
      expect(due[i]!.daysRemaining).toBeGreaterThanOrEqual(due[i - 1]!.daysRemaining);
    }
  });

  it("returns empty for empty candidates", () => {
    expect(computeSuperannuationDue([], "2025-01-01", 365)).toEqual([]);
  });

  it("includes overdue cases (negative days)", () => {
    // Charlie retires 2024-12-31, as of 2025-03-01 → overdue by ~59 days
    const due = computeSuperannuationDue(candidates, "2025-03-01", 365);
    const charlie = due.find((d) => d.employeeId === "e3");
    expect(charlie).toBeDefined();
    expect(charlie!.daysRemaining).toBeLessThan(0);
  });
});

describe("scheduler/engine — computeProbationDue()", () => {
  const candidates = [
    { employeeId: "p1", employeeNo: "P001", fullName: "Devi", status: "probation", dateOfJoiningISO: "2024-01-15", confirmationDateISO: null },
    { employeeId: "p2", employeeNo: "P002", fullName: "Ravi", status: "probation", dateOfJoiningISO: "2024-06-01", confirmationDateISO: "2026-03-01" },
    { employeeId: "p3", employeeNo: "P003", fullName: "Kumar", status: "confirmed", dateOfJoiningISO: "2020-01-01", confirmationDateISO: null },
  ];

  it("includes only probation-status candidates", () => {
    const due = computeProbationDue(candidates, "2025-12-01", 365);
    expect(due.find((d) => d.employeeId === "p3")).toBeUndefined();
  });

  it("uses DOJ + 24 months when confirmationDate is null", () => {
    const due = computeProbationDue(candidates, "2025-12-01", 365);
    const devi = due.find((d) => d.employeeId === "p1");
    expect(devi).toBeDefined();
    // DOJ 2024-01-15 + 24 months = 2026-01-15
    expect(devi!.dueDateISO).toBe("2026-01-15");
    expect(devi!.details.source).toBe("doj_plus_months");
  });

  it("uses confirmationDate when available", () => {
    const due = computeProbationDue(candidates, "2025-12-01", 365);
    const ravi = due.find((d) => d.employeeId === "p2");
    expect(ravi).toBeDefined();
    expect(ravi!.dueDateISO).toBe("2026-03-01");
    expect(ravi!.details.source).toBe("confirmation_date");
  });

  it("returns empty when no one is on probation in window", () => {
    // Use a window in the far past so nothing matches
    const due = computeProbationDue(candidates, "2020-01-01", 30);
    expect(due.length).toBe(0);
  });
});
