import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";
import { OutcomeBudgetTable, formulaFor, polarityNote } from "./OutcomeBudgetTable";

const mockedHook = vi.mocked(useSeededResource);
const O = (over: Record<string, unknown>) => ({
  id: "o1", headId: "h", fy: "2026-27", allocationId: null, schemeId: null, outputDesc: "o", outcomeDesc: "Faster settlement", indicator: "Days to settle", unit: "days",
  baselineValue: "60", targetValue: "30", achievedValue: "20", achievementBps: "10000", allocatedMinor: "0", currency: "INR", status: "active",
  evaluationRating: null, evaluationNote: null, evaluatedBy: null, evaluatedAt: null, effectiveFrom: "2026-04-01", ...over,
});

describe("OutcomeBudgetTable polarity (GAP-FINANCE-BUDGET-OUTCOME-BUDGET-02)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("picks the formula and note for the polarity", () => {
    expect(polarityNote("lower_is_better")).toBe("Lower is better");
    expect(polarityNote("higher_is_better")).toBeNull();
    expect(polarityNote(undefined)).toBeNull();
    expect(formulaFor("lower_is_better")).toMatch(/baseline − achieved/);
    expect(formulaFor(undefined)).toMatch(/achieved − baseline/);
  });

  it("marks a lower-is-better target and shows the overshoot as 100%, not as a shortfall", () => {
    mockedHook.mockReturnValue({ data: [O({ polarity: "lower_is_better" }), O({ id: "o2", outcomeDesc: "Output count", unit: "km", targetValue: "100", achievedValue: "40", achievementBps: "4000" })], offline: false, cachedAt: null, provenance: "live" } as never);
    const { container } = render(<OutcomeBudgetTable outcomes={[]} source="api" />);
    expect(screen.getAllByText("Lower is better")).toHaveLength(1);
    expect(screen.getByText("30 days")).toBeInTheDocument();
    expect(container.textContent).toMatch(/100\.0%/);
    expect(container.textContent).toMatch(/40\.0%/);
  });

  it("shows a dash, not 0.0%, for an unmeasured lower-is-better indicator (blank bps)", () => {
    mockedHook.mockReturnValue({ data: [O({ polarity: "lower_is_better", achievementBps: "", achievedValue: "0" })], offline: false, cachedAt: null, provenance: "live" } as never);
    const { container } = render(<OutcomeBudgetTable outcomes={[]} source="api" />);
    expect(container.textContent).not.toMatch(/0\.0%/);
    expect(screen.getByTitle("No measurement recorded yet")).toBeInTheDocument();
  });
});
