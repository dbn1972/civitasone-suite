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

import OffCyclePage from "./page";

// UX-017: OffCyclePage is a server component (translated via
// getTranslations(), which vitest.setup.ts mocks centrally -- no provider
// needed just for that call), but it also renders CreateOffCycleForm and
// OffCycleCards, both CLIENT components that now call useTranslations().
// Those children need a genuine NextIntlClientProvider in the tree once
// rendered for real by testing-library -- same pattern as
// disbursement/page.test.tsx (tranche 9).
async function renderPage() {
  const ui = await OffCyclePage();
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("OffCyclePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of off-cycle runs", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        {
          id: "o1",
          run_type: "bonus",
          period: "2025-06",
          description: "Diwali bonus",
          total_amount_minor: 500000,
          total_tax_minor: 0,
          total_net_minor: 0,
          status: "draft",
          created_at: "2025-06-01T00:00:00Z",
        },
      ],
      source: "api",
    });

    await renderPage();

    // "Diwali bonus" renders as part of a longer text node ("Period:
    // <strong>2025-06</strong> · Diwali bonus"), not as an isolated string --
    // match by substring instead of exact text.
    expect(screen.getByText((_, el) => el?.textContent === "Period: 2025-06 · Diwali bonus")).toBeInTheDocument();
    expect(screen.getByText("2025-06")).toBeInTheDocument();
  });

  it("renders an empty state when there are no off-cycle runs", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    await renderPage();

    expect(screen.getByText("No off-cycle runs yet")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    await renderPage();

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
