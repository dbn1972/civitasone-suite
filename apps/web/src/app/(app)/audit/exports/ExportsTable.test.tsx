import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExportsTable, type ExportRow } from "./ExportsTable";

function row(over: Partial<ExportRow>): ExportRow {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    jobType: "2026-09-export",
    requestedBy: "user-abc",
    requestedAt: "2026-09-17T10:30:00.000Z",
    format: "json" as const,
    status: "completed" as const,
    downloadUrl: "tok-xyz",
    periodFrom: "2026-09-01T00:00:00.000Z",
    periodTo: "2026-09-30T23:59:59.999Z",
    rowCount: 1234,
    includesPii: true,
    ...over,
  } as ExportRow;
}

describe("ExportsTable (GAP-AUDIT-EXPORTS-04)", () => {
  it("renders distinguishing columns so same-day exports differ: short id, window, rows, PII flag", () => {
    render(<ExportsTable rows={[row({})]} />);
    expect(screen.getByText("11111111")).toBeInTheDocument(); // short id
    expect(screen.getByText(/2026-09-01 → 2026-09-30/)).toBeInTheDocument(); // window
    expect(screen.getByText("1,234")).toBeInTheDocument(); // rows (en-IN)
    expect(screen.getByText("Yes")).toBeInTheDocument(); // PII flag
    expect(screen.getByText("user-abc")).toBeInTheDocument(); // requester
  });

  it("builds the download href through the tokenised proxy, not the raw signedUrl", () => {
    render(<ExportsTable rows={[row({})]} />);
    const link = screen.getByRole("link", { name: "Download" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(
      "/api/proxy/v1/audit/exports/11111111-2222-3333-4444-555555555555/download?token=tok-xyz",
    );
    // never the bare token / raw url
    expect(link.getAttribute("href")).not.toBe("tok-xyz");
  });

  it("shows Verify only on completed rows (GAP-AUDIT-EXPORTS-03)", () => {
    render(
      <ExportsTable
        rows={[
          row({ id: "aaaaaaaa-0000-0000-0000-000000000001", status: "completed" }),
          row({ id: "bbbbbbbb-0000-0000-0000-000000000002", status: "queued", downloadUrl: undefined }),
        ]}
      />,
    );
    const verifyButtons = screen.getAllByRole("button", { name: "Verify" });
    expect(verifyButtons).toHaveLength(1); // only the completed row
  });
});
