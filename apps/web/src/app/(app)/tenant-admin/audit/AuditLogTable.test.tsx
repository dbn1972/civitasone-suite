import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { render } from "@/test-utils/intl-render";
const downloadCsvFile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/export/csvExport", async (orig) => ({
  ...(await orig<typeof import("@/lib/export/csvExport")>()),
  downloadCsvFile,
  tableExportGuard: () => async () => ({ ok: true as const }),
}));

import { AuditLogTable, type AuditEvent } from "./AuditLogTable";

const ev = (o: Partial<AuditEvent>): AuditEvent => ({
  id: "e1",
  timestamp: "2026-01-15T19:00:00.000Z",
  actor: "asha@dept.gov.in",
  ipAddress: "10.1.2.3",
  action: "user.update",
  resource: "user:1",
  outcome: "success",
  ...o,
});

describe("AuditLogTable — GAP-TENANT-ADMIN-AUDIT-03 (DPDP masking)", () => {
  it("masks actor emails and source IPs by default", () => {
    render(<AuditLogTable events={[ev({})]} />);
    // The full email / IP must not appear in clear.
    expect(screen.queryByText("asha@dept.gov.in")).not.toBeInTheDocument();
    expect(screen.queryByText("10.1.2.3")).not.toBeInTheDocument();
    // Masked forms are shown.
    expect(screen.getByText(/a\*\*\*@/)).toBeInTheDocument();
    expect(screen.getByText(/10\.•\.•\.•/)).toBeInTheDocument();
  });

  it("shows a non-email actor identifier as-is (not masked)", () => {
    render(<AuditLogTable events={[ev({ actor: "svc-indexer" })]} />);
    expect(screen.getByText("svc-indexer")).toBeInTheDocument();
  });
});

describe("AuditLogTable — GAP-TENANT-ADMIN-AUDIT-05 (outcome + empty)", () => {
  it("humanizes an unknown outcome instead of printing a raw info pill", () => {
    render(<AuditLogTable events={[ev({ outcome: "denied" })]} />);
    expect(screen.getByText("Denied")).toBeInTheDocument();
  });

  it("shows a tailored empty state when there are no events", () => {
    render(<AuditLogTable events={[]} />);
    expect(screen.getByText(/No audit events yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/No records found/i)).not.toBeInTheDocument();
  });
});

describe("AuditLogTable — exported CSV masks PII", () => {
  beforeEach(() => { downloadCsvFile.mockClear(); });

  it("writes the masked actor email, not the raw one, to the CSV", async () => {
    render(<AuditLogTable events={[ev({}), ev({ id: "e2", actor: "svc-indexer" })]} />);
    fireEvent.click(screen.getByTitle(/recorded in the audit log/i));
    await waitFor(() => expect(downloadCsvFile).toHaveBeenCalledTimes(1));
    const csv = downloadCsvFile.mock.calls[0]![1] as string;
    expect(csv).not.toContain("asha@dept.gov.in");
    expect(csv).toMatch(/a\*\*\*@/);
    expect(csv).toContain("svc-indexer");
  });
});
