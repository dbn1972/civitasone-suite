import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardProjectsTable, type DashboardProjectRow } from "./DashboardProjectsTable";

const ROW: DashboardProjectRow = {
  id: "p1",
  projectCode: "PRJ-1",
  name: "Rural Roads Phase 2",
  scheme: "PMGSY",
  department: "PWD",
  totalBudget: 10_000_000,
  completionPct: 40,
  status: "active",
  rag: "red",
};

describe("DashboardProjectsTable RAG column (GAP-PROJECTS-DASHBOARD-01)", () => {
  it("renders a 'Red' RAG pill with the 'bad' tone and a separate lifecycle Status cell", () => {
    render(<DashboardProjectsTable rows={[ROW]} />);
    // Distinct column headers: lifecycle Status and RAG (no 'RAG Status').
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("RAG")).toBeInTheDocument();
    expect(screen.queryByText("RAG Status")).not.toBeInTheDocument();

    // RAG pill shows the WORD "Red" (not colour-only) with the bad tone.
    const ragPill = screen.getByText("Red");
    expect(ragPill).toHaveClass("pill", "bad");

    // Lifecycle status renders its own humanized "Active" pill.
    const statusPill = screen.getByText("Active");
    expect(statusPill).toHaveClass("pill", "good");
  });

  it("renders a neutral '—' RAG pill when rag is null", () => {
    render(<DashboardProjectsTable rows={[{ ...ROW, rag: null }]} />);
    const pill = screen.getByText("—");
    expect(pill).toHaveClass("pill", "info");
  });
});
