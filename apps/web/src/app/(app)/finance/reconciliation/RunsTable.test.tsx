import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { RunsTable, type RunRow } from "./RunsTable";

const base: RunRow = {
  id: "11111111-1111-1111-1111-111111111111", provider: "book-vs-bank", sourceSystem: "finance-book",
  targetSystem: "bank-statement", status: "completed", sourceCount: 10, targetCount: 10, matchedCount: 10,
  breakCount: 0, balanced: true, startedAt: "2026-07-01T00:00:00.000Z", completedAt: null,
};

// GAP-FINANCE-RECONCILIATION-07
describe("RunsTable unbalanced filter", () => {
  it("toggles to unbalanced-only runs", () => {
    const runs: RunRow[] = [
      { ...base, provider: "balanced-provider" },
      { ...base, id: "22222222-2222-2222-2222-222222222222", provider: "broken-provider", balanced: false, breakCount: 2 },
    ];
    render(<RunsTable runs={runs} />);
    expect(screen.getByText("balanced-provider")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Unbalanced only" }));
    expect(screen.queryByText("balanced-provider")).not.toBeInTheDocument();
    expect(screen.getByText("broken-provider")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "All runs" }));
    expect(screen.getByText("balanced-provider")).toBeInTheDocument();
  });

  it("says every run is balanced when none are unbalanced", () => {
    render(<RunsTable runs={[base]} />);
    fireEvent.click(screen.getByRole("tab", { name: "Unbalanced only" }));
    expect(screen.getByText("No unbalanced runs")).toBeInTheDocument();
  });
});
