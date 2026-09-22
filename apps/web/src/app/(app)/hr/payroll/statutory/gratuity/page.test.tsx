import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import GratuityPage from "./page";

// UX-017: GratuityPage (Server Component, getTranslations("gratuity")) also
// renders GratuityCalculator, a "use client" component that calls
// useTranslations("gratuityCalculator") -- so every render needs a real
// NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("GratuityPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the gratuity register", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "1", employeeId: "e1", yearsOfService: "12.50", gratuityMinor: 500000, status: "computed" }],
      source: "api",
    });
    const ui = await GratuityPage();
    renderPage(ui);
    expect(screen.getByText("e1")).toBeInTheDocument();
  });

  it("renders an empty state when there are no gratuity records", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await GratuityPage();
    renderPage(ui);
    expect(screen.getByText("No gratuity records")).toBeInTheDocument();
  });

  it("shows the error state — not the honest-empty prompt — when the loader errors", async () => {
    // UX-013: replaces the old floating "Couldn't load — showing nothing"
    // badge, which coexisted with (and never gated) the register's own
    // .length === 0 check below it — a real outage and a tenant with zero
    // gratuity records rendered the same "No gratuity records" prompt.
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await GratuityPage();
    renderPage(ui);
    expect(screen.getByText("We couldn't load gratuity records.")).toBeInTheDocument();
    expect(screen.queryByText("No gratuity records")).not.toBeInTheDocument();
  });
});
