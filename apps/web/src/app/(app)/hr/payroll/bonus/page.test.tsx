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

import BonusPage from "./page";

const E1 = "22222222-2222-4222-8222-222222222201";
// GAP-PAYROLL-BONUS-01: the page also resolves names via the hrms directory.
function withDirectory(bonus: { data: unknown; source: string }, names: unknown[] = []) {
  fetchJsonMock.mockImplementation((path: string) =>
    Promise.resolve(path.startsWith("/api/v1/hrms/employees") ? { data: names, source: "api" } : bonus),
  );
}

describe("BonusPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of bonus records", async () => {
    withDirectory({
      data: [
        { id: "b1", employee_id: E1, fy: "2025-26", basic_minor: 5000000, bonus_pct: 8.33, bonus_amount_minor: 416500, status: "computed" },
      ],
      source: "api",
    }, [[E1, { name: "Meera Iyer", employeeNo: "EMP-7" }]]);

    const ui = await BonusPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("Meera Iyer (EMP-7)")).toBeInTheDocument();
    expect(screen.queryByText(E1)).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "2025-26" })).toBeInTheDocument();
  });

  it("renders an empty state when there are no bonus records", async () => {
    withDirectory({ data: [], source: "api" });

    const ui = await BonusPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("No bonus records yet")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    withDirectory({ data: [], source: "error" });

    const ui = await BonusPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
