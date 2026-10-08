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
    expect(screen.getByText("Recent events")).toBeInTheDocument();
    expect(screen.getByText("Success (recent)")).toBeInTheDocument();
    expect(screen.getByText("Failures (recent)")).toBeInTheDocument();
  });

  it("GAP2-AUDIT-HOME-10: does not present the capped/windowed slice as an all-time 'Total Events'", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_ROWS, source: "api" });
    render(await AuditPage());
    // The old mislabel claimed an all-time total over a 7-day / 50-row slice.
    expect(screen.queryByText("Total Events")).not.toBeInTheDocument();
    // The honest label names the figure as recent and explains the window/cap.
    const recent = screen.getByText("Recent events");
    expect(recent).toBeInTheDocument();
    const tile = recent.closest(".stat");
    expect(tile?.getAttribute("title") ?? "").toMatch(/last 7 days/i);
    expect(tile?.getAttribute("title") ?? "").toMatch(/50/);
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
