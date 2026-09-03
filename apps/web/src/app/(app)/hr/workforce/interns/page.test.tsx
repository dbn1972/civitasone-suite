import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import InternsPage from "./page";

// Row-shaped fixtures: fetchJson is mocked wholesale (bypassing the real mapInterns()
// transform in page.tsx), so these must already look like the post-map Row type — not
// the raw ApiEmployee payload (employmentType/stipend-as-number/raw ISO dates).
const MOCK_EMPLOYEES = [
  { id: "i1", name: "Ananya Sharma", institution: "IIT Delhi", department: "R&D", projectAssigned: "AI Integration", stipend: "₹10,000", periodFrom: "01/06/2026", periodTo: "30/11/2026", mentor: "Dr. Mehta", type: "Intern", status: "active" },
  { id: "i2", name: "Rahul Bose", institution: "NIT Trichy", department: "IT", projectAssigned: "Cloud Migration", stipend: "₹8,000", periodFrom: "01/07/2026", periodTo: "31/12/2026", mentor: "Ms. Kapoor", type: "Apprentice", status: "active" },
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
