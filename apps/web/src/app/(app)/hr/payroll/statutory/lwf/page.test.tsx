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

import LwfPage from "./page";

// UX-017: LwfPage (Server Component, getTranslations("lwf")) also renders
// LwfConfigForm, a "use client" component that calls
// useTranslations("lwfConfigForm") -- so every render needs a real
// NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("LwfPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders LWF configuration", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ state_code: "KA", employee_contrib_minor: 2000, employer_contrib_minor: 2000, frequency: "yearly" }],
      source: "api",
    });
    const ui = await LwfPage();
    renderPage(ui);
    expect(screen.getByText("KA")).toBeInTheDocument();
  });

  it("renders an empty state when there is no LWF configuration", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await LwfPage();
    renderPage(ui);
    expect(screen.getByText("No LWF configuration")).toBeInTheDocument();
  });
});
