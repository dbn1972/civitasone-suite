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

import SalaryRevisionsPage from "./page";

// UX-017 (PR #1552 review): SalaryRevisionsPage is a server component
// (translated via getTranslations(), which vitest.setup.ts mocks centrally --
// no provider needed just for that call), but it also renders
// CreateSalaryRevisionForm, a CLIENT component that now calls
// useTranslations(). That child needs a genuine NextIntlClientProvider in the
// tree once rendered for real by testing-library -- same pattern as
// ../off-cycle/page.test.tsx.
async function renderPage() {
  const ui = await SalaryRevisionsPage();
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("SalaryRevisionsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of salary revisions", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        {
          id: "sr1", employee_id: "e1", effective_date: "2026-04-01",
          old_basic_minor: 4000000, new_basic_minor: 4400000,
          old_gross_minor: 8000000, new_gross_minor: 8800000,
          revision_type: "annual_increment", order_no: "ORD-1",
        },
      ],
      source: "api",
    });

    await renderPage();

    expect(screen.getByText("e1")).toBeInTheDocument();
    expect(screen.getAllByText("Annual Increment").length).toBeGreaterThan(0);
  });

  it("renders an empty state when there are no revisions", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    await renderPage();

    expect(screen.getByText("No salary revisions yet")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    await renderPage();

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
