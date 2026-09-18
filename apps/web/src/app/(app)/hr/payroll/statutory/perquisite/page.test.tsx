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

import PerquisitePage from "./page";

// UX-017: PerquisitePage (Server Component, getTranslations("perquisite"))
// also renders EmployeeFyLookup and PerquisiteComponentForm, both "use
// client" components that call useTranslations -- so every render needs a
// real NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PerquisitePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("prompts for employee and FY when none is selected", async () => {
    const ui = await PerquisitePage({ searchParams: {} });
    renderPage(ui);
    expect(screen.getByText("Select an employee and financial year")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders the Form 12BA statement when found", async () => {
    fetchJsonMock.mockResolvedValue({
      data: {
        formType: "12BA", fy: "2026-27", assessmentYear: "2027-28",
        employer: { name: "Govt", tan: "T1", pan: "P1" },
        employee: { employeeId: "e1", pan: "ABCDE1234F", name: "Test Employee", panFlag: "" },
        perquisites: [{ sl: 1, nature: "car", description: "", taxableValueMinor: 50000, value: 500 }],
        totalPerquisitesMinor: 50000, totalPerquisites: 500, note: "ok",
      },
      source: "api",
    });
    const ui = await PerquisitePage({ searchParams: { employeeId: "e1", fy: "2026-27" } });
    renderPage(ui);
    expect(screen.getByText("Test Employee")).toBeInTheDocument();
  });

  it("renders an empty state when no Form 12BA data is found", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "api" });
    const ui = await PerquisitePage({ searchParams: { employeeId: "e1", fy: "2026-27" } });
    renderPage(ui);
    expect(screen.getByText("No Form 12BA data")).toBeInTheDocument();
  });
});
