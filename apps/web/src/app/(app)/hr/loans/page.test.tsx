import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
const rolesMock = vi.fn(() => ["hr_admin"] as string[]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import LoansPage from "./page";

// The API shape (loans-routes.ts list route): raw rows with the instalment counts.
const API_LOANS = [
  { id: "l1", employeeId: "e1", employeeName: "Asha Verma", department: "Finance", loanType: "hba", sanctionedAmountMinor: 120000000, emiMinor: 1000000, outstandingMinor: 90000000, totalEmis: 12, emisPaid: 3, status: "active" },
  { id: "l2", employeeId: "e2", employeeName: "Ravi Kumar", department: "Works", loanType: "personal", sanctionedAmountMinor: 5000000, emiMinor: 0, outstandingMinor: 5000000, totalEmis: 0, emisPaid: 0, status: "pending" },
];

async function renderPage() {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{await LoansPage()}</NextIntlClientProvider>);
}

describe("LoansPage EMI progress column (GAP-HR-LOANS-03)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReturnValue(["hr_admin"]);
    // Run the page's REAL mapResponse over the API payload.
    fetchJsonMock.mockImplementation(async (_url: string, _fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => ({
      data: opts.mapResponse({ data: API_LOANS }),
      source: "api",
    }));
  });

  function rowFor(name: string): HTMLElement {
    return within(screen.getByRole("table")).getByText(name).closest("tr") as HTMLElement;
  }

  it("a loan with 3 of 12 EMIs paid shows '3 / 12' and a 25% bar", async () => {
    await renderPage();
    const row = rowFor("Asha Verma");
    expect(within(row).getByText("3 / 12")).toBeInTheDocument();
    expect(within(row).getByRole("progressbar", { name: "3 of 12 EMIs paid" })).toHaveAttribute("aria-valuenow", "25");
  });

  it("a loan with totalEmis 0 shows a dash and no bar", async () => {
    await renderPage();
    const row = rowFor("Ravi Kumar");
    expect(within(row).queryByRole("progressbar")).toBeNull();
    expect(row.textContent).not.toMatch(/NaN|Infinity|0 \/ 0/);
  });

  it("the column is headed 'EMI Progress'", async () => {
    await renderPage();
    expect(within(screen.getByRole("table")).getByRole("columnheader", { name: /emi progress/i })).toBeInTheDocument();
  });

  it("a role outside the loans gate sees Access restricted and no register", async () => {
    rolesMock.mockReturnValue(["citizen"]);
    await renderPage();
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
