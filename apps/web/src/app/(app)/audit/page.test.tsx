import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import AuditPage from "./page";

const MOCK_ROWS = [
  { actor: "clerk@muni.gov", action: "login", resource: "session", outcome: "success", at: "2026-01-02T10:00:00.000Z", id: "e1" },
  { actor: "clerk@muni.gov", action: "delete", resource: "doc:9", outcome: "failure", at: "2026-01-03T10:00:00.000Z", id: "e2" },
];

describe("AuditPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders KPIs and the log on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ROWS, source: "api" });
    render(await AuditPage());
    expect(screen.getByText("Total Events")).toBeInTheDocument();
    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.getByText("Failures")).toBeInTheDocument();
  });

  it("GAP-AUDIT-HOME-02: has no fabricated 'Policy Alerts' tile", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ROWS, source: "api" });
    render(await AuditPage());
    expect(screen.queryByText("Policy Alerts")).not.toBeInTheDocument();
  });

  it("GAP-AUDIT-HOME-01: an empty tenant shows the empty state, not the error badge", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await AuditPage());
    expect(screen.getByText("No audit events yet")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
  });

  it("GAP-AUDIT-HOME-04: a real fetch failure shows '—' KPIs and the error state, not zeros", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await AuditPage());
    expect(screen.getByText("We couldn't load audit events.")).toBeInTheDocument();
    expect(screen.queryByText("No audit events yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
