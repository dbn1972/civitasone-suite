import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("../../../../../_components/EmployeePicker", () => ({ EmployeePicker: () => null }));
const rolesMock = vi.fn(() => ["payroll_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
}));

import PayGroupDetailPage from "./page";

function withIntl(ui: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>;
}

const GROUP = {
  id: "g1", name: "Gazetted Staff", frequency: "monthly", pay_day_of_month: 28, pay_last_day: false, timezone: "Asia/Kolkata",
  status: "active", ddo_code: "DDO-1", ddo_name: "Finance DDO", bill_type: "gazetted", member_count: 3, active_run_count: 0,
  created_at: "2026-01-05T00:00:00Z",
};
const MEMBER = {
  assignmentId: "a1", employeeId: "e1", employeeNo: "E-1", fullName: "Asha Rao", departmentName: "Finance",
  effectiveFrom: "2026-10-01", effectiveTo: null, status: "current", reason: null,
};

function mockApi(opts: { group?: { data: unknown; source: "api" | "error"; status?: number }; members?: { data: unknown; source: "api" | "error" } } = {}) {
  fetchJsonMock.mockImplementation(async (path: string) => {
    if (path.includes("/members")) return opts.members ?? { data: { data: [MEMBER], total: 1 }, source: "api" };
    if (path.endsWith("/pay-groups")) return { data: [{ id: "g1", name: "Gazetted Staff" }, { id: "g2", name: "Contract Staff" }], source: "api" };
    return opts.group ?? { data: GROUP, source: "api" };
  });
}

describe("PayGroupDetailPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("details tab shows schedule, DDO, translated bill type and the deactivate control", async () => {
    mockApi();
    render(withIntl(await PayGroupDetailPage({ params: { id: "g1" }, searchParams: {} })));
    expect(screen.getByText("Finance DDO (DDO-1)")).toBeInTheDocument();
    expect(screen.getByText("Gazetted")).toBeInTheDocument();
    expect(screen.getByText("28th")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "3" })).toHaveAttribute("href", "/hr/payroll/pay-groups/g1?tab=members");
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    // members are only fetched for the members tab
    expect(fetchJsonMock.mock.calls.some((c) => String(c[0]).includes("/members"))).toBe(false);
  });

  it("members tab lists members with Move / End for admins and history links", async () => {
    mockApi();
    render(withIntl(await PayGroupDetailPage({ params: { id: "g1" }, searchParams: { tab: "members" } })));
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Open-ended")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move Asha Rao to another pay group" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End membership of Asha Rao" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign employee" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show history" })).toHaveAttribute("href", "/hr/payroll/pay-groups/g1?tab=members&history=true");
    const membersUrl = String(fetchJsonMock.mock.calls.find((c) => String(c[0]).includes("/members"))![0]);
    expect(membersUrl).toContain("history=false");
    expect(membersUrl).toContain("limit=50");
  });

  it("read-only roles get the members but no mutation controls", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    mockApi();
    render(withIntl(await PayGroupDetailPage({ params: { id: "g1" }, searchParams: { tab: "members" } })));
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move|End membership|Assign employee|Bulk assign/ })).not.toBeInTheDocument();
  });

  it("a failed members load is an error, not 'no current members'", async () => {
    mockApi({ members: { data: { data: [], total: 0 }, source: "error" } });
    render(withIntl(await PayGroupDetailPage({ params: { id: "g1" }, searchParams: { tab: "members" } })));
    expect(screen.queryByText("No current members")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("an empty successful members load shows the empty state", async () => {
    mockApi({ members: { data: { data: [], total: 0 }, source: "api" } });
    render(withIntl(await PayGroupDetailPage({ params: { id: "g1" }, searchParams: { tab: "members", history: "true" } })));
    expect(screen.getByText("No membership history")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hide history" })).toBeInTheDocument();
  });

  it("an unknown pay group reads as not found", async () => {
    mockApi({ group: { data: null, source: "error", status: 404 } });
    render(withIntl(await PayGroupDetailPage({ params: { id: "nope" }, searchParams: {} })));
    expect(screen.getByText(/could not be found/)).toBeInTheDocument();
  });

  it("denies non-payroll roles without fetching", async () => {
    rolesMock.mockReturnValue(["employee"]);
    render(withIntl(await PayGroupDetailPage({ params: { id: "g1" }, searchParams: {} })));
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});
