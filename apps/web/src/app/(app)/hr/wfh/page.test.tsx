import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

/**
 * CRITICAL fix regression coverage: /hr/wfh's only "+ New Request" button
 * used to link to /hr/workforce/wfh, which is role-gated to hr_admin/
 * hr_officer/manager/super_admin -- excluding `employee` entirely, even
 * though WFH is inherently self-initiated by the employee. This page now
 * embeds the create form directly (self-service prefilled for a plain
 * employee, admin picker for HR/manager -- same getEmployees-then-
 * getMyProfile resolution as leave/apply/page.tsx) and an approve/reject
 * action column for HR/manager (mirroring RegularisationTable).
 */
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

import WfhPage from "./page";

// This page embeds real (unmocked) "use client" components -- WFHRequestForm
// and WfhRequestsTable -- which call useTranslations() directly. Unlike the
// page's own getTranslations() (mocked globally in vitest.setup.ts), a
// client-side useTranslations() needs a real NextIntlClientProvider in the
// tree, same pattern as leave/apply/page.test.tsx.
function render(page: Promise<React.ReactElement>) {
  return page.then((ui) => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>));
}

const MOCK_REQUESTS = [
  { id: "w1", employeeId: "e1", employeeName: "Sunita Rao", fromDate: "2026-08-18", toDate: "2026-08-19", reason: "Project work", status: "approved" },
  { id: "w2", employeeId: "e2", employeeName: "Kartik Das", fromDate: "2026-08-20", toDate: "2026-08-20", reason: "Travel", status: "pending" },
];

describe("WfhPage (/hr/wfh)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getEmployeesMock.mockReset();
    getMyProfileMock.mockReset();
    mockRoles = ["employee"];
  });

  it("is reachable by the employee role and renders a real create form, not a permission wall", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" }); // 403 for `employee`, normalized to empty
    getMyProfileMock.mockResolvedValue({ data: { id: "emp-self", name: "Self Employee", department: "IT", employeeNo: "E-1", status: "active", designation: "Officer" }, source: "api" });

    await render(WfhPage());

    expect(screen.queryByText(/access restricted/i)).not.toBeInTheDocument();
    expect(screen.getByRole("form", { name: /work from home request form/i })).toBeInTheDocument();
    // Self-service: the employee picker is hidden entirely (prefilled to "me").
    expect(screen.queryByLabelText(/employee id/i)).not.toBeInTheDocument();
  });

  it("shows a clear message instead of a broken form for an employee with no linked profile", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
    getMyProfileMock.mockResolvedValue({ data: null, source: "api", status: 404 });

    await render(WfhPage());

    expect(screen.queryByRole("form", { name: /work from home request form/i })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/no employee record/i);
  });

  it("gives hr_admin/manager the employee picker (file on behalf of)", async () => {
    mockRoles = ["hr_admin"];
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    getEmployeesMock.mockResolvedValue({
      data: [{ id: "e1", name: "Sunita Rao", department: "Finance", status: "active" }],
      source: "api",
    });

    await render(WfhPage());

    expect(getMyProfileMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/employee id/i)).toBeInTheDocument();
  });

  it("does not show Approve/Reject controls for a plain employee", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
    getMyProfileMock.mockResolvedValue({ data: { id: "e2", name: "Kartik Das", department: "IT", employeeNo: "E-2", status: "active", designation: "Officer" }, source: "api" });

    await render(WfhPage());

    expect(screen.queryByRole("button", { name: /^approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^reject$/i })).not.toBeInTheDocument();
  });

  it("shows Approve/Reject controls for a pending request to a manager", async () => {
    mockRoles = ["manager"];
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    getEmployeesMock.mockResolvedValue({
      data: [{ id: "e1", name: "Sunita Rao", department: "Finance", status: "active" }],
      source: "api",
    });

    await render(WfhPage());

    expect(screen.getByRole("button", { name: /^approve$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeInTheDocument();
  });
});
