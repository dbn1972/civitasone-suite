import { describe, it, expect } from "vitest";
import { checkPostingDate, periodOfDate } from "./periodStatus";

const periods = [
  { period: "2026-04", status: "open" },
  { period: "2026-03", status: "hard_close" },
  { period: "2026-02", status: "soft_close" },
];

describe("checkPostingDate (GAP-FINANCE-JOURNAL-ENTRY-03)", () => {
  it("maps each status", () => {
    expect(checkPostingDate("2026-04-10", periods)).toEqual({ kind: "open", period: "2026-04" });
    expect(checkPostingDate("2026-03-31", periods)).toEqual({ kind: "hard_close", period: "2026-03" });
    expect(checkPostingDate("2026-02-01", periods)).toEqual({ kind: "soft_close", period: "2026-02" });
  });
  it("a month with no period row is unknown", () => {
    expect(checkPostingDate("2026-09-01", periods)).toEqual({ kind: "unknown", period: "2026-09" });
  });
  it("a failed period load is unverified, never silently open", () => {
    expect(checkPostingDate("2026-04-10", null)).toEqual({ kind: "unverified", period: "2026-04" });
  });
  it("a malformed date yields null", () => {
    expect(checkPostingDate("", periods)).toBeNull();
    expect(periodOfDate("2026-13-01")).toBeNull();
  });
});
