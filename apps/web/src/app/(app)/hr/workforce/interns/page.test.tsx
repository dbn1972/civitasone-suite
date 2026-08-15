import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import InternsPage from "./page";

const MOCK_EMPLOYEES = [
  { id: "i1", name: "Ananya Sharma", institution: "IIT Delhi", department: "R&D", projectAssigned: "AI Integration", stipend: 10000, periodFrom: "2026-06-01", periodTo: "2026-11-30", mentor: "Dr. Mehta", employmentType: "intern", status: "active" },
  { id: "i2", name: "Rahul Bose", institution: "NIT Trichy", department: "IT", projectAssigned: "Cloud Migration", stipend: 8000, periodFrom: "2026-07-01", periodTo: "2026-12-31", mentor: "Ms. Kapoor", employmentType: "apprentice", status: "active" },
];

describe("InternsPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders intern names and institutions", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_EMPLOYEES, source: "api" });
    render(await InternsPage());
    expect(screen.getByText("Ananya Sharma")).toBeInTheDocument();
    expect(screen.getByText("IIT Delhi")).toBeInTheDocument();
  });

  it("renders project assignments", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_EMPLOYEES, source: "api" });
    render(await InternsPage());
    expect(screen.getByText("AI Integration")).toBeInTheDocument();
  });

  it("renders mentor names", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_EMPLOYEES, source: "api" });
    render(await InternsPage());
    expect(screen.getByText("Dr. Mehta")).toBeInTheDocument();
  });

  it("renders stat cards for interns and apprentices", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_EMPLOYEES, source: "api" });
    render(await InternsPage());
    expect(screen.getByText("Interns")).toBeInTheDocument();
    expect(screen.getByText("Apprentices")).toBeInTheDocument();
  });

  it("renders stipend formatted in INR", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_EMPLOYEES, source: "api" });
    render(await InternsPage());
    expect(screen.getByText("₹10,000")).toBeInTheDocument();
  });

  it("renders empty state when no interns", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await InternsPage());
    expect(screen.getByText(/No interns or apprentices/i)).toBeInTheDocument();
  });
});
