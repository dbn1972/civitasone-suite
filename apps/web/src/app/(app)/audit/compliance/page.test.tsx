import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import AuditCompliancePage from "./page";

function row(partial: Record<string, unknown>) {
  return {
    id: "x",
    lawOrRule: "CERT-In direction",
    requirement: "req",
    frequency: "annual",
    dueDate: "2026-01-01",
    department: "IT",
    status: "complied",
    ...partial,
  };
}

describe("AuditCompliancePage (GAP-AUDIT-COMPLIANCE-01)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("a real fetch failure shows '—' and never a false 'Compliant'", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await AuditCompliancePage());
    expect(screen.queryByText("Compliant")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("an empty tenant shows 'No data', not a false 'Compliant'", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await AuditCompliancePage());
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.queryByText("Compliant")).not.toBeInTheDocument();
  });

  it("3 complied and 0 overdue reads 'Compliant'", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })],
      source: "api",
    });
    render(await AuditCompliancePage());
    expect(screen.getAllByText("Compliant").length).toBeGreaterThan(0);
    // GAP-AUDIT-COMPLIANCE-04: no static "6-hr reporting" delta copy.
    expect(screen.queryByText("6-hr reporting")).not.toBeInTheDocument();
  });
});
