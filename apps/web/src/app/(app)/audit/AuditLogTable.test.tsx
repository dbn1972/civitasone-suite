import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { AuditRowSummary } from "@civitasone/types";
import { AuditLogTable } from "./AuditLogTable";

const ROWS: AuditRowSummary[] = [
  { actor: "a@x.gov", action: "login", resource: "session", outcome: "success", at: "2026-01-02T10:00:00.000Z", id: "older" },
  { actor: "b@x.gov", action: "delete", resource: "doc:9", outcome: "failure", at: "2026-01-05T10:00:00.000Z", id: "newer" },
];

describe("AuditLogTable (GAP-AUDIT-HOME-03)", () => {
  it("renders a When column", () => {
    render(<AuditLogTable rows={ROWS} />);
    expect(screen.getByText("When")).toBeInTheDocument();
  });

  it("renders an Event id column", () => {
    render(<AuditLogTable rows={ROWS} />);
    expect(screen.getByText("Event id")).toBeInTheDocument();
  });

  it("orders rows newest-first by default", () => {
    render(<AuditLogTable rows={ROWS} />);
    const rowEls = screen.getAllByRole("row");
    // rowEls[0] is the header; the first data row must be the newer event.
    const firstData = rowEls[1];
    expect(within(firstData).getByText("delete")).toBeInTheDocument();
  });
});
