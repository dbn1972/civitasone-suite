import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReportJobsTable, type JobRow } from "./ReportJobsTable";

function row(over: Partial<JobRow> = {}): JobRow {
  return {
    id: "j1", reportName: "R1", module: "finance", requestedBy: "Unknown user",
    format: "pdf", statusPill: "completed", download: "—", downloadUrl: null, ...over,
  } as JobRow;
}

describe("ReportJobsTable", () => {
  // GAP-REPORTS-LIST-02: status filter
  it("filters rows by the selected status segment", () => {
    render(
      <ReportJobsTable rows={[row({ id: "a", reportName: "Done", statusPill: "completed" }), row({ id: "b", reportName: "Broke", statusPill: "failed" })]} />,
    );
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Broke")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Failed" }));
    expect(screen.getByText("Broke")).toBeInTheDocument();
    expect(screen.queryByText("Done")).not.toBeInTheDocument();
  });

  // GAP-REPORTS-LIST-02: failed job shows a reason line, not a bare dash
  it("a failed job shows 'Reason not recorded'", () => {
    render(<ReportJobsTable rows={[row({ statusPill: "failed" })]} />);
    expect(screen.getByText("Reason not recorded")).toBeInTheDocument();
  });
});
