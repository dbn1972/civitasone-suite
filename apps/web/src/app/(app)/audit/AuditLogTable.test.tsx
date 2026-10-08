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

  it("GAP2-AUDIT-HOME-11: renders a non-success/failure outcome as its own neutral pill, not a red failure", () => {
    const rows: AuditRowSummary[] = [
      { actor: "a@x.gov", action: "export", resource: "report:7", outcome: "skipped", at: "2026-01-06T10:00:00.000Z", id: "skip1" },
    ];
    render(<AuditLogTable rows={rows} />);
    const pill = screen.getByText("skipped");
    expect(pill).toBeInTheDocument();
    // It must NOT be painted as a failure pill.
    expect(pill.className).not.toContain("bad");
    expect(pill.className).toContain("pill");
    // And no spurious "failure" label was substituted for it.
    expect(screen.queryByText("failure")).not.toBeInTheDocument();
  });
});
