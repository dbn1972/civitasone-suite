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

import LoansPage from "./page";

// UX-017: LoansPage (Server Component, getTranslations("payrollLoans")) also
// renders LoanSearchForm/CreateLoanForm/LoansTable, "use client" components
// that call useTranslations(...) -- so every render needs a real
// NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("LoansPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("prompts for an employee search when no empId is given, without fabricating data", async () => {
    const ui = await LoansPage({ searchParams: {} });
    renderPage(ui);

    expect(screen.getByText("Search for an employee to see their loans")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders loans for the searched employee", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "l1", loanNo: "LN-1", loanType: "personal", principalMinor: "100000", outstandingMinor: "50000", emiMinor: "10000", tenureMonths: 10, status: "applied" }],
      source: "api",
    });

    const ui = await LoansPage({ searchParams: { empId: "11111111-1111-1111-1111-111111111111" } });
    renderPage(ui);

    expect(screen.getByText("LN-1")).toBeInTheDocument();
  });

  it("shows the error data-source badge when the API fails for a searched employee", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await LoansPage({ searchParams: { empId: "11111111-1111-1111-1111-111111111111" } });
    renderPage(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("notes the recovery schedule endpoint is not available", async () => {
    const ui = await LoansPage({ searchParams: {} });
    renderPage(ui);

    expect(screen.getByText("Recovery schedule not yet available")).toBeInTheDocument();
  });
});
