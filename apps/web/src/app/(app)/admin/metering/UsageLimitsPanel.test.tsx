import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UsageLimitsPanel } from "./UsageLimitsPanel";
import { limitCell } from "./usageLimits";

const r = (resource: string, used: number, limit: number) => ({ resource, label: resource, icon: "", used, limit, unit: "calls", projectedOverageDate: null });

// GAP-ADMIN-METERING-05
describe("limitCell", () => {
  it("92% of the limit warns and says so in words", () => {
    expect(limitCell(r("api_calls_daily", 92, 100))).toMatchObject({ percent: 92, level: "warn", text: "92% of limit" });
  });
  it("100% and above is over the limit; below 80% is ok", () => {
    expect(limitCell(r("users", 120, 100))).toMatchObject({ level: "bad", text: "120% of limit - over limit" });
    expect(limitCell(r("users", 79, 100)).level).toBe("ok");
    expect(limitCell(r("users", 80, 100)).level).toBe("warn");
  });
  it("no limit, a zero limit or an unusable number never divides: it is a dash", () => {
    for (const lim of [0, -1, Number.NaN]) {
      const c = limitCell(r("storage_gb", 5, lim));
      expect(c).toMatchObject({ percent: null, level: "none", text: "—" });
    }
    expect(limitCell(r("storage_gb", Number.NaN, 10)).level).toBe("none");
  });
});

describe("UsageLimitsPanel", () => {
  it("shows the percentage text next to the bar for a near-limit resource", () => {
    render(<UsageLimitsPanel resources={[r("api_calls_daily", 92, 100), r("documents", 3, 0)]} source="api" />);
    const near = screen.getByTestId("limit-api_calls_daily");
    expect(near).toHaveAttribute("data-level", "warn");
    expect(near).toHaveTextContent("92% of limit");
    expect(screen.getByTestId("limit-documents")).toHaveTextContent("No limit set");
  });
  it("distinguishes failed load from nothing reported", () => {
    const { rerender } = render(<UsageLimitsPanel resources={[]} source="error" errorStatus={500} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    rerender(<UsageLimitsPanel resources={[]} source="api" />);
    expect(screen.getByText("No limits reported")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
