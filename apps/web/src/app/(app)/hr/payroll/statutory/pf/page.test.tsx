import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import PfStatutoryPage from "./page";

// UX-017: PfStatutoryPage (Server Component, getTranslations("pf")) also
// renders EcrGeneratorForm, a "use client" component that calls
// useTranslations("ecrGeneratorForm") -- so every render needs a real
// NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PfStatutoryPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the PF ledger", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "1", employeeId: "e1", period: "2026-06", basicMinor: 5000000, empContribMinor: 600000, erContribMinor: 600000 }],
      source: "api",
    });
    const ui = await PfStatutoryPage();
    renderPage(ui);
    expect(screen.getByText("e1")).toBeInTheDocument();
  });

  it("renders an empty state when there are no PF records", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await PfStatutoryPage();
    renderPage(ui);
    expect(screen.getByText("No PF records")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the loader errors", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await PfStatutoryPage();
    renderPage(ui);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
