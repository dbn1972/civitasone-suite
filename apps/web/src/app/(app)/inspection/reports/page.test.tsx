import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// UAT Phase 2 C3 (J13): the inspection-report register.
const getInspectionReportsMock = vi.fn();
vi.mock("../_data/loaders", () => ({ getInspectionReports: (...a: unknown[]) => getInspectionReportsMock(...a) }));
let roles: string[] = ["inspector"];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles }));

import InspectionReportsPage from "./page";

const REPORT = {
  id: "aaaaaaaa-1111-4000-8000-000000000001", inspectionId: "bbbbbbbb-1111-4000-8000-000000000001",
  reportType: "follow_up", overallGrade: "B", status: "submitted", createdAt: "2026-11-02T10:00:00.000Z",
};

beforeEach(() => { getInspectionReportsMock.mockReset(); roles = ["inspector"]; });

describe("InspectionReportsPage", () => {
  it("lists reports with type, grade and status labels, linking to the report", async () => {
    getInspectionReportsMock.mockResolvedValue({ data: [REPORT], source: "api" });
    render(await InspectionReportsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Follow-up")).toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open aaaaaaaa" })).toHaveAttribute("href", `/inspection/reports/${REPORT.id}`);
    expect(screen.getAllByRole("link", { name: "+ New report" })[0]).toHaveAttribute("href", "/inspection/reports/new");
  });

  it("shows an empty state, an error state, and no create button for a read-only role", async () => {
    getInspectionReportsMock.mockResolvedValue({ data: [], source: "api" });
    roles = ["supervising_officer"];
    const { unmount } = render(await InspectionReportsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("No inspection reports yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "+ New report" })).toBeNull();
    unmount();
    getInspectionReportsMock.mockResolvedValue({ data: [], source: "error" });
    render(await InspectionReportsPage({ searchParams: Promise.resolve({}) }));
    expect(screen.queryByText("No inspection reports yet")).toBeNull();
  });

  it("after a create, says the report will appear shortly (202 = received), and filters by inspection", async () => {
    getInspectionReportsMock.mockResolvedValue({ data: [], source: "api" });
    render(await InspectionReportsPage({ searchParams: Promise.resolve({ created: "x", inspectionId: REPORT.inspectionId }) }));
    expect(screen.getByText(/will appear in this list shortly/)).toBeInTheDocument();
    expect(getInspectionReportsMock).toHaveBeenCalledWith(REPORT.inspectionId);
    expect(screen.getAllByRole("link", { name: "+ New report" })[0]).toHaveAttribute("href", `/inspection/reports/new?inspectionId=${REPORT.inspectionId}`);
  });
});
