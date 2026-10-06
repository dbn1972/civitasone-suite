import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
