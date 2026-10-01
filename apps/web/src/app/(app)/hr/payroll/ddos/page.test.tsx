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
const rolesMock = vi.fn(() => ["payroll_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
}));

import DdosPage from "./page";

const D1 = "aaaaaaaa-0000-0000-0000-000000000001";
const D2 = "aaaaaaaa-0000-0000-0000-000000000002";

function routeFetch(ddos: unknown, ddoSource: "api" | "error" = "api", deptSource: "api" | "error" = "api") {
  fetchJsonMock.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes("/hrms/departments")
        ? deptSource === "error"
          ? { data: [], source: "error" }
          : { data: [{ id: D1, code: "REV", name: "Revenue" }, { id: D2, code: "HLT", name: "Health" }], source: "api" }
        : { data: ddos, source: ddoSource },
    ),
  );
}

async function renderPage(searchParams?: { edit?: string }) {
  const ui = await DdosPage({ searchParams });
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("DdosPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("shows which departments each DDO covers, by name (DDOS-03)", async () => {
    routeFetch([{ ddoCode: "DDO01", name: "Directorate of Treasuries", departmentIds: [D1, D2] }]);
    await renderPage();
    expect(screen.getByText("Directorate of Treasuries")).toBeInTheDocument();
    expect(screen.getByText("Revenue (REV), Health (HLT)")).toBeInTheDocument();
  });

  it("says department names are unavailable (not 'None', not raw ids) when the names fetch fails", async () => {
    routeFetch([{ ddoCode: "DDO01", name: "Treasury", departmentIds: [D1, D2] }, { ddoCode: "DDO02", name: "Empty", departmentIds: [] }], "api", "error");
    await renderPage();
    expect(screen.getByText("Department names couldn't be loaded (2 mapped)")).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(D1))).not.toBeInTheDocument();
    // A DDO with genuinely no mapped departments still reads "None".
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("renders an empty state and an em-dash average when there are no DDOs (DDOS-05)", async () => {
    routeFetch([]);
    await renderPage();
    expect(screen.getByText("No DDOs configured yet")).toBeInTheDocument();
    const statValues = Array.from(document.querySelectorAll(".val")).map((n) => n.textContent);
    expect(statValues).toEqual(["0", "0", "0", "—"]);
  });

  it("shows an error state and hides the form when the DDO list fails to load", async () => {
    routeFetch([], "error");
    await renderPage();
    expect(screen.getByText("We couldn't load ddos.")).toBeInTheDocument();
    expect(screen.queryByText("Create DDO")).not.toBeInTheDocument();
  });

  it("prefills the form in edit mode from ?edit=CODE (DDOS-03)", async () => {
    routeFetch([{ ddoCode: "DDO01", name: "Directorate of Treasuries", departmentIds: [D1] }]);
    await renderPage({ edit: "DDO01" });
    expect(screen.getByText("Edit DDO DDO01")).toBeInTheDocument();
    expect((screen.getByLabelText(/DDO Code/) as HTMLInputElement).readOnly).toBe(true);
  });

  it("hides the form from read-only roles and denies employees (DDOS-04)", async () => {
    routeFetch([]);
    rolesMock.mockReturnValue(["hr_admin"]);
    await renderPage();
    expect(screen.queryByText("Create DDO")).not.toBeInTheDocument();

    fetchJsonMock.mockClear();
    rolesMock.mockReturnValue(["employee"]);
    await renderPage();
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});
