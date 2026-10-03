import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockRoles: string[] = ["hr_officer"];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("./GrievanceActions", () => ({ GrievanceActions: () => <div data-testid="actions" /> }));

import GrievanceDetailPage from "./page";

const BASE = {
  id: "g1", caseNo: "GRV/2026/0007", employeeId: "e1", employee: "A. Kumar", category: "pay_allowances",
  subject: "DA arrears", description: "My DA arrears for March are missing.", filedDate: "2026-03-02",
  status: "under_inquiry", assignedTo: "o1", assignedToName: "R. Singh", assignedAt: "2026-03-03T00:00:00Z",
  disposition: null, disposalRemarks: null, disposedAt: null,
  events: [
    { id: "ev1", action: "register", fromStatus: null, toStatus: "registered", note: null, assignedToName: null, createdAt: "2026-03-02T05:00:00Z" },
    { id: "ev2", action: "assign", fromStatus: "registered", toStatus: "under_inquiry", note: "take this up", assignedToName: "R. Singh", createdAt: "2026-03-03T05:00:00Z" },
  ],
};

describe("GrievanceDetailPage", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); mockRoles = ["hr_officer"]; });

  it("blocks non-HR roles without fetching", async () => {
    mockRoles = ["manager"];
    render(await GrievanceDetailPage({ params: { id: "g1" } }));
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("shows the description (detail-only), assignee name and history, and actions while open", async () => {
    fetchJsonMock.mockResolvedValue({ data: BASE, source: "api" });
    render(await GrievanceDetailPage({ params: { id: "g1" } }));
    expect(screen.getAllByText("GRV/2026/0007").length).toBeGreaterThan(0);
    expect(screen.getByText("My DA arrears for March are missing.")).toBeInTheDocument();
    expect(screen.getAllByText(/R\. Singh/).length).toBeGreaterThan(0);
    expect(screen.getByText("take this up")).toBeInTheDocument();
    expect(screen.getByTestId("actions")).toBeInTheDocument();
  });

  it("hides the Assign/Dispose actions once disposed", async () => {
    fetchJsonMock.mockResolvedValue({ data: { ...BASE, status: "disposed", disposition: "resolved", disposalRemarks: "Arrears paid." }, source: "api" });
    render(await GrievanceDetailPage({ params: { id: "g1" } }));
    expect(screen.queryByTestId("actions")).not.toBeInTheDocument();
    expect(screen.getByText("Arrears paid.")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });

  it("does not report a failed load as not-found data: a 404 shows the not-found state", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await GrievanceDetailPage({ params: { id: "nope" } }));
    expect(screen.getByRole("heading", { name: "Grievance not found" })).toBeInTheDocument();
  });
});
