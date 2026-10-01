import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// GAP-HR-TRANSFER-10: the transfer UI is translated client-side, so every render needs a provider.
const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
const getEmployeeByIdMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getEmployeeById: (...args: unknown[]) => getEmployeeByIdMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn() } }),
}));
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

import TransferPage from "./page";

describe("TransferPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getEmployeeByIdMock.mockReset();
    mockRoles = [];
  });

  it("shows a genuine empty state -- not an error -- when the API legitimately returns zero transfers", async () => {
    // Regression test: this page used to re-fetch a second, nonexistent
    // endpoint whenever the first result's array was empty, and used that
    // guaranteed-error result instead -- turning a real "zero transfers"
    // success into a false error state. There must be exactly one fetchJson
    // call, and it must render as a real empty state.
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await TransferPage({});
    render(ui);

    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No transfer orders")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
  });

  it("tells the truth on a real fetch failure instead of the old 'Showing saved information' copy", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await TransferPage({});
    render(ui);

    expect(screen.getByText("Couldn't load transfer orders — showing nothing")).toBeInTheDocument();
  });

  it("falls back to raw ids instead of blank cells when the backend row has no joined names yet", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "t1", employeeId: "emp-42", fromDeptId: "dept-a", toDeptId: "dept-b", status: "pending" },
      ],
      source: "api",
    });

    const ui = await TransferPage({});
    render(ui);

    expect(screen.getAllByText("emp-42").length).toBeGreaterThan(0);
  });

  // GAP-HR-TRANSFER-01: the backend now resolves employeeName and
  // fromDepartmentName/toDepartmentName (GAP-HR-SF-17, already merged) --
  // this mapping previously checked the wrong field names and always fell
  // through to the raw ids regardless.
  it("uses the resolved employeeName/fromDepartmentName/toDepartmentName when the backend supplies them", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        {
          id: "t1", employeeId: "emp-42", fromDeptId: "dept-a", toDeptId: "dept-b", status: "requested",
          employeeName: "Asha Rao", fromDepartmentName: "Finance", toDepartmentName: "Estate",
        },
      ],
      source: "api",
    });

    const ui = await TransferPage({});
    render(ui);

    expect(screen.getAllByText("Asha Rao").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Finance/).length).toBeGreaterThan(0);
    expect(screen.queryByText("emp-42")).not.toBeInTheDocument();
  });

  // UX-01x: a 403 (this route is HR-role-gated -- see
  // services/hrms-service/src/modules/lifecycle/routes.ts's HR_ROLES guard
  // on GET /v1/hrms/lifecycle/transfers) used to render the exact same
  // "couldn't load, try again" panel as a real network failure. Retrying a
  // permanent authorization boundary can never succeed, so that was actively
  // misleading -- it must show the honest, specific reason instead.
  it("shows an honest 'Access restricted' message (not the generic retry message) when the backend returns 403", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [],
      source: "error",
      status: 403,
      errorMessage: "requires one of: hr_admin, hr_officer, super_admin",
    });

    const ui = await TransferPage({});
    render(ui);

    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.getByText("Requires one of: hr_admin, hr_officer, super_admin.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("still shows the generic 'try again' message for a genuine transient failure (no status -- e.g. a network error)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await TransferPage({});
    render(ui);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
  });

  // GAP-HR-TRANSFER-03: "+ Transfer with approval" used to render for every
  // role hr/layout.tsx admits into /hr (manager, employee, payroll_*,
  // tenant_admin...), though the backend it submits to only ever accepted
  // hr_admin/hr_officer/super_admin -- everyone else could fill in both
  // wizard steps and only find out at the very end, via a raw error.
  describe("role gating for raising a transfer (GAP-HR-TRANSFER-03)", () => {
    beforeEach(() => fetchJsonMock.mockResolvedValue({ data: [], source: "api" }));

    it("hides the raise-transfer action and shows a read-only note for a role that cannot submit", async () => {
      mockRoles = ["manager"];
      const ui = await TransferPage({});
      render(ui);
      expect(screen.queryByRole("button", { name: "+ Transfer with approval" })).not.toBeInTheDocument();
      expect(screen.getByText(/view-only access to transfer orders/)).toBeInTheDocument();
    });

    it("shows the raise-transfer action for hr_officer", async () => {
      mockRoles = ["hr_officer"];
      const ui = await TransferPage({});
      render(ui);
      expect(screen.getByRole("button", { name: "+ Transfer with approval" })).toBeInTheDocument();
      expect(screen.queryByText(/view-only access to transfer orders/)).not.toBeInTheDocument();
    });
  });

  // GAP-HR-TRANSFER-09
  describe("empId prefill (GAP-HR-TRANSFER-09)", () => {
    beforeEach(() => fetchJsonMock.mockResolvedValue({ data: [], source: "api" }));

    it("resolves ?empId= server-side and does not blow up when the role can't raise a transfer anyway", async () => {
      mockRoles = ["manager"];
      const ui = await TransferPage({ searchParams: { empId: "11111111-1111-4111-8111-111111111111" } });
      render(ui);
      // Not looked up at all for a role that can't use it -- no point paying
      // for the request.
      expect(getEmployeeByIdMock).not.toHaveBeenCalled();
    });

    it("looks up the employee for a role that can raise a transfer", async () => {
      mockRoles = ["hr_admin"];
      getEmployeeByIdMock.mockResolvedValue({ data: { name: "Asha Rao" }, source: "api" });
      const ui = await TransferPage({ searchParams: { empId: "11111111-1111-4111-8111-111111111111" } });
      render(ui);
      expect(getEmployeeByIdMock).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    });
  });
});
