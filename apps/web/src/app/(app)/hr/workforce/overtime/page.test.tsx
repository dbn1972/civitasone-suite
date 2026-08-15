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

describe("OvertimePage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders overtime claim list", async () => {
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
    expect(screen.getByRole("link", { name: /new request/i })).toHaveAttribute("href", "/hr/workforce/overtime/new");
  });

  it("renders empty state when no requests", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await OvertimePage());
    expect(screen.getByText(/No overtime requests yet/i)).toBeInTheDocument();
    // Empty state also shows the new request link
    expect(screen.getAllByRole("link", { name: /new request/i }).length).toBeGreaterThan(0);
  });

  it("shows CCS Rules reference in subtitle", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await OvertimePage());
    expect(screen.getByText(/CCS Rules/i)).toBeInTheDocument();
  });
});
