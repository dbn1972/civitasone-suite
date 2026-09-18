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

import ProfessionalTaxPage from "./page";

// UX-017: ProfessionalTaxPage (Server Component, getTranslations("pt")) also
// renders PtSlabForm, a "use client" component that calls
// useTranslations("ptSlabForm") -- so every render needs a real
// NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ProfessionalTaxPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders PT slabs", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ state_code: "KA", slab_from_minor: 0, slab_to_minor: 1500000, pt_amount_minor: 0 }],
      source: "api",
    });
    const ui = await ProfessionalTaxPage();
    renderPage(ui);
    expect(screen.getByText("KA")).toBeInTheDocument();
  });

  it("renders an empty state when there are no PT slabs", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await ProfessionalTaxPage();
    renderPage(ui);
    expect(screen.getByText("No PT slabs configured")).toBeInTheDocument();
  });
});
