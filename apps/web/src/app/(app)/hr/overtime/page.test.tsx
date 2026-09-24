import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import OvertimePage from "./page";

const MOCK_OT = [
  { id: "o1", employeeId: "e1", requestDate: "2026-08-10", hoursRequested: "3", reason: "Budget report", status: "pending", approvedBy: null, approvedAt: null },
  { id: "o2", employeeId: "e2", requestDate: "2026-08-09", hoursRequested: "2", reason: "System migration", status: "approved", approvedBy: "mgr1", approvedAt: "2026-08-10" },
];

describe("OvertimePage (self-service)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders overtime request list", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_OT, source: "api" });
    render(await OvertimePage());
    expect(screen.getByText("2026-08-10")).toBeInTheDocument();
  });

  it("shows total hours stat", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_OT, source: "api" });
    render(await OvertimePage());
    expect(screen.getByText("5.0 h")).toBeInTheDocument();
  });

  it("renders link to new overtime request", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_OT, source: "api" });
    render(await OvertimePage());
    expect(screen.getByRole("link", { name: /new request/i })).toHaveAttribute("href", "/hr/overtime/new");
  });

  it("renders empty state when there are genuinely no requests", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await OvertimePage());
    expect(screen.getByText("No overtime requests yet")).toBeInTheDocument();
    // A genuine empty result is zero, not unknown — stats should read 0, not "—".
    expect(screen.getByText("0.0 h")).toBeInTheDocument();
  });

  // Regression test (Wave 4 / cluster D): this was the only one of the
  // attendance-adjacent self-service pages whose stat cards weren't gated on
  // fetch failure. getOvertimeRequests() falls back to `[]` on error (third
  // arg to fetchJson), so pending/approved/totalHrs all computed as a
  // genuine-looking "0" — indistinguishable from a real empty result —
  // instead of the honest "we don't know" every sibling page already shows.
  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await OvertimePage());
    expect(screen.getByText("We couldn't load overtime requests.")).toBeInTheDocument();
    expect(screen.queryByText("No overtime requests yet")).not.toBeInTheDocument();
    // StatCard's displayValue renders null/undefined as "—" — the same
    // convention departments/page.tsx and its sibling self-service pages
    // (work-summary, travel, advances, loans, expenses) already rely on.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // Specifically: the hours stat must not read as a fabricated "0.0 h".
    expect(screen.queryByText("0.0 h")).not.toBeInTheDocument();
  });
});
