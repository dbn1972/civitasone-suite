import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import EmployeeTypesPage from "./page";

const MOCK_TYPES = [
  {
    id: "t1", code: "PERM", name: "Permanent", description: null,
    eligibleForLeave: true, eligibleForPayroll: true, eligibleForAppraisal: true,
    defaultProbationMonths: 6, maxContractMonths: null,
    payMode: "monthly", isActive: true, sortOrder: 1,
  },
];

describe("EmployeeTypesPage", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); mockRoles = ["hr_admin"]; });

  it("shows PermissionDenied and never fetches for a role the backend would 403 (GAP-HR-EMPLOYEE-TYPES-04)", async () => {
    mockRoles = ["employee"];
    render(await EmployeeTypesPage());
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it.each(["hr_officer", "payroll_officer", "payroll_admin", "manager"])(
    "%s can read the list (read roles widened to match the backend)", async (role) => {
      mockRoles = [role];
      fetchJsonMock.mockResolvedValue({ data: MOCK_TYPES, source: "api" });
      render(await EmployeeTypesPage());
      expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
      expect(fetchJsonMock).toHaveBeenCalled();
    },
  );

  it("renders employee types and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_TYPES, source: "api" });
    render(await EmployeeTypesPage());
    expect(screen.getAllByText("Total Types").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when there genuinely are no employee types", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await EmployeeTypesPage());
    expect(screen.getByText("No employee types defined")).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await EmployeeTypesPage());
    expect(screen.getByText("We couldn't connect.")).toBeInTheDocument();
    expect(screen.queryByText("No employee types defined")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

// The success-path mock above predates the statutory columns; these rows
// carry the full field set the API returns (employee-types-routes.ts).
const FULL_TYPE = {
  id: "t-full", code: "CONS", name: "Consultant", description: "Engaged on a fixed-fee professional contract",
  eligibleForLeave: false, eligibleForPayroll: false, eligibleForAppraisal: true,
  defaultProbationMonths: 0, maxContractMonths: 12,
  payMode: "consolidated", category: "consultant", paymentRoute: "invoice", taxSection: "194J",
  statutoryPf: false, statutoryEsi: false, statutoryNps: false,
  eligibleForGratuity: false, eligibleForBonus: false, leaveEncashment: false,
  isActive: true, sortOrder: 2,
};

/** GAP-HR-EMPLOYEE-TYPES-03 */
describe("EmployeeTypesPage — statutory & benefit columns, description (GAP-HR-EMPLOYEE-TYPES-03)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); mockRoles = ["hr_admin"]; });

  async function renderRows(types: unknown[]) {
    fetchJsonMock.mockResolvedValue({ data: types, source: "api" });
    return render(await EmployeeTypesPage());
  }
  /** The text of one cell of the data row whose Code cell is `code`. */
  function cell(code: string, column: string): string {
    const table = screen.getAllByRole("table")[0] as HTMLElement;
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent ?? "");
    const idx = headers.findIndex((h) => h.startsWith(column));
    expect(idx, `column ${column} should exist`).toBeGreaterThanOrEqual(0);
    const row = within(table).getAllByRole("row").find((r) => within(r).queryByText(code)) as HTMLElement;
    return (within(row).getAllByRole("cell")[idx] as HTMLElement).textContent ?? "";
  }

  it("a consultant type with tax section 194J and PF off shows '194J' and no PF in the Statutory cell", async () => {
    await renderRows([FULL_TYPE]);
    expect(cell("CONS", "Tax Section")).toBe("194J");
    expect(cell("CONS", "Statutory")).toBe("None");
    expect(cell("CONS", "Statutory")).not.toContain("PF");
  });

  it("lists exactly the statutory flags that are on", async () => {
    await renderRows([{ ...FULL_TYPE, statutoryPf: true, statutoryNps: true }]);
    expect(cell("CONS", "Statutory")).toBe("PF, NPS");
  });

  it("shows gratuity, bonus and leave encashment in a Benefits column, per flag", async () => {
    await renderRows([
      { ...FULL_TYPE, code: "PERM", eligibleForGratuity: true, eligibleForBonus: true, leaveEncashment: true },
      { ...FULL_TYPE, id: "t2", code: "BON", eligibleForBonus: true },
      FULL_TYPE,
    ]);
    expect(cell("PERM", "Benefits")).toBe("Gratuity, Bonus, Leave encashment");
    expect(cell("BON", "Benefits")).toBe("Bonus");
    expect(cell("CONS", "Benefits")).toBe("None");
  });

  it("shows the benefits to a viewer who cannot manage types too (they never reach the edit form)", async () => {
    mockRoles = ["payroll_officer"];
    await renderRows([{ ...FULL_TYPE, eligibleForGratuity: true }]);
    expect(cell("CONS", "Benefits")).toBe("Gratuity");
  });

  it("an unknown category renders its raw code rather than blank", async () => {
    await renderRows([{ ...FULL_TYPE, category: "volunteer_corps" }]);
    expect(cell("CONS", "Category")).toBe("volunteer_corps");
  });

  it("shows the description as a muted second line under the type name", async () => {
    await renderRows([FULL_TYPE]);
    const desc = screen.getByText("Engaged on a fixed-fee professional contract");
    expect(desc).toBeInTheDocument();
    // Same cell as the name, and styled muted (not a separate column).
    const nameCell = desc.closest("td") as HTMLElement;
    expect(nameCell.querySelectorAll("span")[0]?.textContent).toBe("Consultant");
    expect(nameCell).toContainElement(desc);
    expect(desc.style.color).toBe("var(--mut)");
  });

  it("renders no empty description line for a type without one", async () => {
    await renderRows([{ ...FULL_TYPE, description: null }, { ...FULL_TYPE, id: "t3", code: "BLANK", description: "   " }]);
    const nameCell = screen.getAllByText("Consultant")[0]!.closest("td") as HTMLElement;
    expect(nameCell.querySelectorAll("span")).toHaveLength(1);
  });

  it("the table sits in the design system's horizontally scrolling wrapper, so it stays usable at 375px", async () => {
    const { container } = await renderRows([FULL_TYPE]);
    const table = container.querySelector("table") as HTMLElement;
    expect(table.closest(".tbl-wrap")).not.toBeNull();
  });
});

/** GAP-HR-EMPLOYEE-TYPES-05 */
describe("EmployeeTypesPage — plain-text eligibility and pay-mode fallback (GAP-HR-EMPLOYEE-TYPES-05)", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); mockRoles = ["hr_admin"]; });

  it("the leave / payroll / appraisal cells read Yes or No, with no emoji glyph", async () => {
    fetchJsonMock.mockResolvedValue({ data: [FULL_TYPE, { ...FULL_TYPE, id: "t4", code: "ALL", eligibleForLeave: true, eligibleForPayroll: true }], source: "api" });
    const { container } = render(await EmployeeTypesPage());
    const table = container.querySelector("table") as HTMLElement;
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent ?? "");
    const rows = within(table).getAllByRole("row").slice(1);
    const cellsFor = (col: string) => rows.map((r) => (within(r).getAllByRole("cell")[headers.findIndex((h) => h.startsWith(col))] as HTMLElement).textContent);
    expect(cellsFor("Leave")).toEqual(["No", "Yes"]);
    expect(cellsFor("Payroll")).toEqual(["No", "Yes"]);
    expect(cellsFor("Appraisal")).toEqual(["Yes", "Yes"]);
    expect(table.textContent).not.toMatch(/[✅✔✓]/u);
  });

  it("a pay mode with no label ('weekly') is humanised to 'Weekly', not shown as the raw code", async () => {
    fetchJsonMock.mockResolvedValue({ data: [{ ...FULL_TYPE, payMode: "weekly" }], source: "api" });
    const { container } = render(await EmployeeTypesPage());
    const text = (container.querySelector("table") as HTMLElement).textContent ?? "";
    expect(text).toContain("Weekly");
    expect(text).not.toMatch(/(^|[^A-Za-z])weekly/);
  });

  it("a snake_case unknown pay mode is title-cased word by word", async () => {
    fetchJsonMock.mockResolvedValue({ data: [{ ...FULL_TYPE, payMode: "piece_rate" }], source: "api" });
    const { container } = render(await EmployeeTypesPage());
    expect((container.querySelector("table") as HTMLElement).textContent).toContain("Piece Rate");
  });

  it("known pay modes keep their translated labels", async () => {
    fetchJsonMock.mockResolvedValue({ data: [{ ...FULL_TYPE, payMode: "monthly" }], source: "api" });
    const { container } = render(await EmployeeTypesPage());
    expect((container.querySelector("table") as HTMLElement).textContent).toContain("Monthly salary");
  });
});
