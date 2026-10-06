import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InvestigationTable } from "./InvestigationTable";
import type { InvestigationSummary } from "@/app/_data/loaders";

// useSeededResource reads IndexedDB/online state; in jsdom it falls back to the
// seeded server rows, which is what we assert against.
const ROWS: InvestigationSummary[] = [
  {
    id: "i1",
    caseId: "INV-1",
    subject: "Procurement kickback allegation",
    assignedTo: "officer-1",
    started: "2026-03-05",
    findings: "Vendor overbilled by 12 lakh",
    status: "in_progress",
  },
];

describe("InvestigationTable PII masking (GAP-AUDIT-INVESTIGATION-02)", () => {
  it("masks subject/findings and hides CSV export for a non-privileged role", () => {
    render(<InvestigationTable rows={ROWS} source="api" canViewDetail={false} />);
    expect(screen.queryByText("Procurement kickback allegation")).not.toBeInTheDocument();
    expect(screen.queryByText("Vendor overbilled by 12 lakh")).not.toBeInTheDocument();
    expect(screen.getAllByText("••••••").length).toBeGreaterThanOrEqual(2);
    // CSV export control absent (exportable=false)
    expect(screen.queryByRole("button", { name: /export|csv|download/i })).not.toBeInTheDocument();
  });

  it("shows the free text for an audit role", () => {
    render(<InvestigationTable rows={ROWS} source="api" canViewDetail />);
    expect(screen.getByText("Procurement kickback allegation")).toBeInTheDocument();
    expect(screen.getByText("Vendor overbilled by 12 lakh")).toBeInTheDocument();
  });
});
