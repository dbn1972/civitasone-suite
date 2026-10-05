import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider as __Intl } from "next-intl";
import __enMessages from "@/messages/en.json";
function render(ui: React.ReactElement) {
  return rtlRender(<__Intl locale="en" messages={__enMessages}>{ui}</__Intl>);
}

const fetchJsonMock = vi.fn();
vi.mock("../../../../_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const rolesMock = vi.fn(() => [] as string[]);
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => rolesMock() };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import GrievanceDetailPage from "./page";

const ID = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";

function grievance(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    referenceNo: "DARPG/2026/000123",
    citizenName: "Ravi Kumar",
    citizenPhone: "9876543210",
    citizenEmail: "ravi@example.com",
    category: "Water Supply",
    subject: "No water for 3 days",
    priority: "high",
    status: "FORWARDED",
    assignedTo: undefined,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    version: 2,
    ...overrides,
  };
}

describe("GrievanceDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue(["crm_user"]);
  });

  // GAP-CRM-GRIEVANCES-DETAIL-05 — citizen contact is masked for a base
  // crm_user (no PII-read role). The clear value must never reach the DOM.
  it("masks citizen phone and email for a role without PII-read rights", async () => {
    fetchJsonMock.mockResolvedValue({ data: grievance(), source: "api" });
    const ui = await GrievanceDetailPage({ params: { id: ID } });
    render(ui);

    expect(screen.queryByText("9876543210")).not.toBeInTheDocument();
    expect(screen.queryByText("ravi@example.com")).not.toBeInTheDocument();
    expect(screen.getByText(/masked under the DPDP Act/i)).toBeInTheDocument();
  });

  it("shows citizen contact in clear for a PII-read role", async () => {
    rolesMock.mockReturnValue(["crm_admin"]);
    fetchJsonMock.mockResolvedValue({ data: grievance(), source: "api" });
    const ui = await GrievanceDetailPage({ params: { id: ID } });
    render(ui);

    expect(screen.getByText("9876543210")).toBeInTheDocument();
    expect(screen.getByText("ravi@example.com")).toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-DETAIL-04 — forwardedTo, appealReason and a Forwarded
  // timeline step are displayed once the backend returns them.
  it("renders forwarded department, appeal reason and a Forwarded timeline step", async () => {
    fetchJsonMock.mockResolvedValue({
      data: grievance({
        status: "APPEAL",
        forwardedTo: "Water Dept",
        forwardedAt: "2026-08-01T06:00:00.000Z",
        appealReason: "No response in 30 days",
        escalatedAt: "2026-08-03T00:00:00.000Z",
      }),
      source: "api",
    });
    const ui = await GrievanceDetailPage({ params: { id: ID } });
    render(ui);

    expect(screen.getByText("Forwarded To")).toBeInTheDocument();
    expect(screen.getByText(/Water Dept/)).toBeInTheDocument();
    expect(screen.getByText("Appeal Reason")).toBeInTheDocument();
    expect(screen.getByText("No response in 30 days")).toBeInTheDocument();
    // Timeline has a Forwarded step and the First appeal rename.
    expect(screen.getByText("Forwarded")).toBeInTheDocument();
    expect(screen.getByText("First appeal")).toBeInTheDocument();
    expect(screen.queryByText("Escalated")).not.toBeInTheDocument();
  });

  // GAP-CRM-GRIEVANCES-DETAIL-07 — a 5xx/network error must show a retry state,
  // not "Grievance not found".
  it("renders a retry error state (not 'not found') on a 500", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    const ui = await GrievanceDetailPage({ params: { id: ID } });
    render(ui);

    expect(screen.queryByText("Grievance not found")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
  });

  it("renders 'Grievance not found' on a 404", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    const ui = await GrievanceDetailPage({ params: { id: ID } });
    render(ui);

    expect(screen.getAllByText("Grievance not found").length).toBeGreaterThan(0);
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument();
  });
});
