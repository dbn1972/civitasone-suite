import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = ["employee"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const getEmployeesMock = vi.fn();
const getMyProfileMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getEmployees: (...args: unknown[]) => getEmployeesMock(...args),
  getMyProfile: (...args: unknown[]) => getMyProfileMock(...args),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ShiftRequestsPage from "./page";

// This page embeds real (unmocked) "use client" components --
// ShiftChangeRequestForm and ShiftRequestsTable -- which call
// useTranslations() directly, so renders need a real NextIntlClientProvider
// (same pattern as leave/apply/page.test.tsx and hr/wfh/page.test.tsx).
function render(page: Promise<React.ReactElement>) {
  return page.then((ui) => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>));
}

// Matches the real GET /v1/hrms/shift-requests shape (employeeName, no department).
const MOCK_REQUESTS = [
  { id: "r1", employeeId: "e1", employeeName: "Priya Nair", currentShift: "General Duty", requestedShift: "Morning Shift", effectiveDate: "2026-09-01", reason: "Family care", status: "pending" },
  { id: "r2", employeeId: "e2", employeeName: "Arvind Kumar", currentShift: "Morning Shift", requestedShift: "Evening Shift", effectiveDate: "2026-09-01", reason: "Health", status: "approved" },
];

function stubEmployeeSelfService() {
  getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
  getMyProfileMock.mockResolvedValue({
    data: { id: "emp-self", name: "Self Employee", department: "IT", employeeNo: "E-1", status: "active", designation: "Officer" },
    source: "api",
  });
}

describe("ShiftRequestsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getEmployeesMock.mockReset();
    getMyProfileMock.mockReset();
    mockRoles = ["employee"];
    stubEmployeeSelfService();
  });

  it("renders shift change requests from API", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    await render(ShiftRequestsPage());
    expect(screen.getByText("Priya Nair")).toBeInTheDocument();
    expect(screen.getByText("Arvind Kumar")).toBeInTheDocument();
  });

  it("shows stat cards for pending and approved counts", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    await render(ShiftRequestsPage());
    expect(screen.getByText("Pending Approval")).toBeInTheDocument();
    // getAllByText, not getByText: "Approved" also appears as the status
    // pill text for r2's row, alongside the StatCard label.
    expect(screen.getAllByText("Approved").length).toBeGreaterThan(0);
  });

  it("renders page title", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await render(ShiftRequestsPage());
    // level: 1 disambiguates the PageHeader's <h1> from the Card's <h3>
    // title, which is also literally "Shift Change Requests".
    expect(screen.getByRole("heading", { level: 1, name: /shift change requests/i })).toBeInTheDocument();
  });

  it("renders empty state when no requests", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await render(ShiftRequestsPage());
    expect(screen.getByText(/No shift change requests/i)).toBeInTheDocument();
  });

  // CRITICAL fix regression coverage below: this feature used to be entirely
  // view-only -- no create route, no button linking to one, no action column.

  it("is reachable by the employee role and renders a real create form", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await render(ShiftRequestsPage());
    expect(screen.getByRole("form")).toBeInTheDocument();
    // Self-service: the employee picker is hidden entirely (prefilled to "me").
    expect(screen.queryByLabelText(/^employee/i)).not.toBeInTheDocument();
  });

  it("gives hr_admin the employee picker (file on behalf of)", async () => {
    mockRoles = ["hr_admin"];
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    getEmployeesMock.mockResolvedValue({
      data: [{ id: "e1", name: "Priya Nair", department: "IT", status: "active" }],
      source: "api",
    });
    await render(ShiftRequestsPage());
    expect(getMyProfileMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^employee/i)).toBeInTheDocument();
  });

  it("does not show Approve/Reject controls for a plain employee", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    await render(ShiftRequestsPage());
    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();
  });

  it("shows Approve/Reject controls for a pending request to a manager", async () => {
    mockRoles = ["manager"];
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    await render(ShiftRequestsPage());
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });
});
