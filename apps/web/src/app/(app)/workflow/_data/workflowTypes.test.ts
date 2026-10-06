import { describe, it, expect } from "vitest";
import {
  inProgressCount,
  formatBreachRate,
  formatSlaMinutes,
} from "./workflowTypes";

describe("inProgressCount (GAP-WORKFLOW-HOME-03)", () => {
  it("sums active + pending + running", () => {
    expect(inProgressCount({ active: 2, pending: 3, running: 1 })).toBe(6);
  });
  it("ignores completed/cancelled and missing keys", () => {
    expect(inProgressCount({ active: 2, completed: 9, cancelled: 4 })).toBe(2);
    expect(inProgressCount({})).toBe(0);
  });
});

describe("formatBreachRate (GAP-WORKFLOW-HOME-04)", () => {
  it("renders a 0..1 fraction as a percentage", () => {
    expect(formatBreachRate(0.63, 100)).toBe("63.0%");
  });
  it("returns an em dash when there are no SLA-tracked tasks (no false 0.0%)", () => {
    expect(formatBreachRate(0, 0)).toBe("—");
  });
  it("clamps out-of-range values defensively", () => {
    expect(formatBreachRate(1.5, 10)).toBe("100.0%");
    expect(formatBreachRate(-0.2, 10)).toBe("0.0%");
  });
});

describe("formatSlaMinutes (GAP-WORKFLOW-DEFINITIONS-DETAIL-04)", () => {
  it("formats 2880 minutes as 2 days", () => {
    expect(formatSlaMinutes(2880)).toBe("2.0d");
  });
  it("returns null for a missing SLA", () => {
    expect(formatSlaMinutes(null)).toBeNull();
  });
});
