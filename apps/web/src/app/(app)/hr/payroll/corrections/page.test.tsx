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

import CorrectionsPage from "./page";

// UX-017: CorrectionsPage is a server component (translated via
// getTranslations(), which vitest.setup.ts mocks centrally -- no provider
// needed just for that call), but it also renders CreateCorrectionForm, a
// CLIENT component that now calls useTranslations(). That child needs a
// genuine NextIntlClientProvider in the tree once rendered for real by
// testing-library -- same pattern as disbursement/page.test.tsx (tranche 9).
async function renderPage() {
  const ui = await CorrectionsPage();
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("CorrectionsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of salary corrections", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        {
          id: "c1",
          employee_id: "e1",
          component: "BASIC",
          effective_from: "2025-04-01",
          old_value_minor: 4000000,
          new_value_minor: 4500000,
          arrears_minor: 1500000,
          affected_periods: 3,
          reason: "Pay fixation",
          status: "pending",
          created_at: "2025-06-01T00:00:00Z",
        },
      ],
      source: "api",
    });

    await renderPage();

    expect(screen.getByText("e1")).toBeInTheDocument();
    expect(screen.getByText("BASIC")).toBeInTheDocument();
  });

  it("renders an empty state when there are no corrections", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    await renderPage();

    expect(screen.getByText("No salary corrections yet")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    await renderPage();

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
