import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const rolesMock = vi.fn<() => string[]>(() => []);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
}));

import DepartmentsPage from "./page";
import hiMessages from "@/messages/hi.json";

const MOCK_DEPTS = [{ id: "d1", code: "FIN", name: "Finance", parentId: null }];

// UX-017 (tranche 3): DepartmentsPage now reads its copy through next-intl
// (getTranslations("departments") server-side, and DepartmentsTable's own
// useTranslations("departmentsTable") client-side once rendered as a
// child) -- both need a real provider in the tree. getTranslations itself
// is handled by the global next-intl/server mock in vitest.setup.ts; this
// wrapper covers the nested client component's useTranslations call, same
// pattern as citizen/grievances/GrievancesTable.test.tsx.
async function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await DepartmentsPage()}
    </NextIntlClientProvider>,
  );
}

describe("DepartmentsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue([]);
  });

  it("renders departments and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_DEPTS, source: "api" });
    await renderPage();
    expect(screen.getAllByText("Total Departments").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when there genuinely are no departments", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("No departments yet")).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByText("We couldn't connect.")).toBeInTheDocument();
    expect(screen.queryByText("No departments yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

/**
 * GAP-HR-DEPARTMENTS-01: the "No Employees" card counts departments with zero
 * employees. A department the API sent no employeeCount for is unknown, not
 * empty -- so the card must not coerce it to 0 and overstate the number.
 */
describe("DepartmentsPage — No Employees stat is honest about unknown counts (GAP-HR-DEPARTMENTS-01)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue([]);
  });

  function statValue(label: string): string {
    const labelEl = screen.getByText(label);
    return labelEl.parentElement?.textContent?.replace(label, "").trim() ?? "";
  }

  it("shows the real number of empty departments when every row carries a count", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "a", code: "A", name: "Alpha", parentId: null, employeeCount: 0 },
        { id: "b", code: "B", name: "Beta", parentId: null, employeeCount: 7 },
        { id: "c", code: "C", name: "Gamma", parentId: null, employeeCount: 0 },
      ],
      source: "api",
    });
    await renderPage();
    expect(statValue("No Employees")).toContain("2");
  });

  it("shows an em dash, not a coerced count, when any department lacks employeeCount", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "a", code: "A", name: "Alpha", parentId: null, employeeCount: 0 },
        { id: "b", code: "B", name: "Beta", parentId: null },
      ],
      source: "api",
    });
    await renderPage();
    expect(statValue("No Employees")).toBe("—");
  });

  it("renders a single plus on the New Department button (no doubled '+ +')", async () => {
    // page.tsx draws the decorative plus itself (aria-hidden); the translation must not carry another.
    rolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({ data: MOCK_DEPTS, source: "api" });
    await renderPage();
    const link = screen.getByRole("link", { name: "New Department" });
    expect(link.textContent).toBe("+ New Department");
    expect(link.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe("+");
  });

  it("carries no literal plus in the New Department label in either locale", () => {
    expect(enMessages.departments.newBtn).not.toMatch(/\+/);
    expect(hiMessages.departments.newBtn).not.toMatch(/\+/);
  });
});
