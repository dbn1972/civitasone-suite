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

// GAP-HR-SALARY-STRUCTURE-05: defaults to a role that passes both the
// page's view gate and its create-structure gate, so every pre-existing
// test below (written before this page had any role gate at all) keeps
// exercising the same behaviour unchanged. Individual tests override via
// getSessionRolesMock.mockReturnValue([...]).
const getSessionRolesMock = vi.fn();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
}));

import PayStructuresPage from "./page";

describe("PayStructuresPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("renders salary structure cards with structure names", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        data: [
          { id: "s1", name: "Standard Grade Pay", isDefault: true, status: "active" },
          { id: "s2", name: "Contractual Pay", isDefault: false, status: "active" },
        ],
        source: "api",
      })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await PayStructuresPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("Standard Grade Pay")).toBeInTheDocument();
    expect(screen.getByText("Contractual Pay")).toBeInTheDocument();
  });

  it("renders an empty state when there are no structures", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await PayStructuresPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("No pay structures yet")).toBeInTheDocument();
  });

  it("renders component grid when components are present", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        data: [{ id: "s1", name: "Basic Pay Structure", isDefault: true, status: "active" }],
        source: "api",
      })
      .mockResolvedValueOnce({
        data: [
          { id: "c1", code: "BASIC", name: "Basic Pay", componentType: "earning", isTaxable: true, structureId: "s1" },
          { id: "c2", code: "DA", name: "Dearness Allowance", componentType: "earning", isTaxable: true, structureId: "s1" },
          { id: "c3", code: "HRA", name: "House Rent Allowance", componentType: "allowance", isTaxable: false, structureId: "s1" },
        ],
        source: "api",
      });

    const ui = await PayStructuresPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("Basic Pay")).toBeInTheDocument();
    expect(screen.getByText("Dearness Allowance")).toBeInTheDocument();
    expect(screen.getByText("House Rent Allowance")).toBeInTheDocument();
  });

  it("shows stat cards with correct counts", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        data: [
          { id: "s1", name: "Group A Pay", isDefault: true, status: "active" },
          { id: "s2", name: "Group C Pay", isDefault: false, status: "inactive" },
        ],
        source: "api",
      })
      .mockResolvedValueOnce({
        data: [
          { id: "c1", code: "BASIC", name: "Basic Pay", componentType: "earning", isTaxable: true, structureId: "s1" },
        ],
        source: "api",
      });

    const ui = await PayStructuresPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    // Total structures = 2, active = 1, default = 1, components = 1
    expect(screen.getByText("2")).toBeInTheDocument(); // total or active
    expect(screen.getByText("Total Structures")).toBeInTheDocument();
  });

  // GAP-HR-SALARY-STRUCTURE-05 regression coverage: this page used to
  // render the full structures/components data for ANY authenticated
  // session, with no gate at all.
  it("shows PermissionDenied to an employee session and never calls the data loaders", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);

    const ui = await PayStructuresPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it.each([["payroll_officer"], ["payroll_admin"], ["super_admin"]])(
    "lets a %s session through to the structures table",
    async (role) => {
      getSessionRolesMock.mockReturnValue([role]);
      fetchJsonMock
        .mockResolvedValueOnce({
          data: [{ id: "s1", name: "Viewable Structure", isDefault: true, status: "active" }],
          source: "api",
        })
        .mockResolvedValueOnce({ data: [], source: "api" });

      const ui = await PayStructuresPage();
      render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

      expect(screen.queryByText("Access restricted")).not.toBeInTheDocument();
      expect(screen.getByText("Viewable Structure")).toBeInTheDocument();
    },
  );

  it.each([["hr_admin"], ["finance_officer"]])(
    "lets a %s session view structures (backend READER_ROLES) but hides the create-structure form (backend PAYROLL_ROLES is narrower)",
    async (role) => {
      getSessionRolesMock.mockReturnValue([role]);
      fetchJsonMock
        .mockResolvedValueOnce({
          data: [{ id: "s1", name: "Viewable Structure", isDefault: true, status: "active" }],
          source: "api",
        })
        .mockResolvedValueOnce({ data: [], source: "api" });

      const ui = await PayStructuresPage();
      render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

      expect(screen.queryByText("Access restricted")).not.toBeInTheDocument();
      expect(screen.getByText("Viewable Structure")).toBeInTheDocument();
      expect(screen.queryByText("Create Pay Structure")).not.toBeInTheDocument();
    },
  );
});
