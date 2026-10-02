import { describe, it, expect } from "vitest";
import { chequeStatusCounts, drawnOnLabel } from "./chequeRegister";

describe("chequeStatusCounts (GAP-FINANCE-TREASURY-CHEQUES-04)", () => {
  it("every status is counted so the cards add up to Total", () => {
    const c = chequeStatusCounts([
      { status: "issued" }, { status: "issued" }, { status: "presented" }, { status: "cleared" },
      { status: "bounced" }, { status: "cancelled" }, { status: "stale" },
    ]);
    expect(c).toEqual({ total: 7, issued: 2, presented: 1, cleared: 1, bounced: 1, cancelled: 1, other: 1 });
    expect(c.issued + c.presented + c.cleared + c.bounced + c.cancelled + c.other).toBe(c.total);
  });
});

describe("drawnOnLabel (GAP-FINANCE-TREASURY-CHEQUES-05)", () => {
  it("distinguishes two accounts at one bank by last four digits", () => {
    expect(drawnOnLabel("SBI", "1234")).not.toBe(drawnOnLabel("SBI", "9876"));
    expect(drawnOnLabel("SBI", "1234")).toContain("1234");
  });
  it("never shows more than four digits", () => {
    expect(drawnOnLabel("SBI", "123456789012")).toBe("SBI \u2022\u2022\u2022\u2022 9012");
  });
  it("falls back to the bank name alone", () => {
    expect(drawnOnLabel("SBI", null)).toBe("SBI");
  });
});
