import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import Page from "./page";

const mapped = {
  projectCode: "UMANG",
  periods: [
    { period: "2026-09", suppressed: false, grossMinor: "1000000", employerCostMinor: "120000", totalCostMinor: "1120000", headcount: 4 },
    { period: "2026-10", suppressed: true },
  ],
  suppressedPeriods: 1,
  totals: { grossMinor: "1000000", employerCostMinor: "120000", totalCostMinor: "1120000" },
};
async function renderPage() {
  const ui = await Page({ params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({ from: "2026-04", to: "2026-09" }) });
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("Project staff-cost page", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("shows totals by month and says plainly that individual pay is never shown", async () => {
    fetchJsonMock.mockResolvedValue({ data: mapped, source: "api" });
    const { container } = await renderPage();
    expect(screen.getByText("Totals only. Individual pay is never shown here.")).toBeInTheDocument();
    expect(screen.getByText("2026-09")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/employeeId|salary slip/i);
    expect(fetchJsonMock.mock.calls[0]![0]).toContain("/api/v1/projects/p1/staff-cost?from=2026-04&to=2026-09");
  });

  it("a month with fewer than 3 people is shown as hidden, with no amount", async () => {
    fetchJsonMock.mockResolvedValue({ data: mapped, source: "api" });
    const { container } = await renderPage();
    expect(screen.getByText("2026-10")).toBeInTheDocument();
    expect(screen.getAllByText("Hidden (fewer than 3 people)").length).toBeGreaterThan(0);
    expect(screen.getByText(/Totals add up the visible months only/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/777/);
  });

  it("someone who is not this project's manager gets the permission screen, not an error", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 403 });
    await renderPage();
    expect(screen.queryByText("Totals only. Individual pay is never shown here.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /access restricted/i })).toBeInTheDocument();
  });
});
