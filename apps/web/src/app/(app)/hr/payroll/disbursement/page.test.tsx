import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import DisbursementPage from "./page";

describe("DisbursementPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  function mockResponses(overrides: { runs?: unknown; sponsor?: unknown; dsc?: unknown; transfers?: unknown; source?: "api" | "error" } = {}) {
    const source = overrides.source ?? "api";
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/runs")) return Promise.resolve({ data: overrides.runs ?? [], source });
      if (path.includes("sponsor-bank-config")) return Promise.resolve({ data: overrides.sponsor ?? null, source });
      if (path.includes("dsc-config")) return Promise.resolve({ data: overrides.dsc ?? null, source });
      if (path.includes("disbursement/transfers")) return Promise.resolve({ data: overrides.transfers ?? [], source });
      // Every real loader on this page declares its own empty default ([] or
      // null), and fetchJson() always resolves to that default on failure --
      // it never resolves to a bare null for an array-shaped loader. Match
      // that contract instead of returning null for any unrecognised path,
      // which previously crashed the whole page (transfers.filter on null)
      // before any assertion below ever ran.
      return Promise.resolve({ data: [], source });
    });
  }

  it("renders payroll runs eligible for disbursement", async () => {
    mockResponses({
      runs: [
        { id: "r1", payPeriod: "2026-07", employeeCount: 10, grossAmount: 100000, netAmount: 90000, status: "completed" },
      ],
    });

    const ui = await DisbursementPage();
    render(ui);

    // "2026-07" appears as run-selector option text, with the eligible run
    // auto-selected so the wizard's first-step CTA is immediately usable.
    // (There is no "Generate & Download" button in this component -- the
    // real 4-step wizard's step-0 action is "Next: Preview ->"; the previous
    // assertion here checked for text that has never existed.)
    expect(screen.getAllByText("2026-07").length).toBeGreaterThan(0);
    expect(screen.getByText("Next: Preview \u2192")).toBeEnabled();
  });

  it("renders the run's net amount as rupees, not divided by 100 again", async () => {
    // Regression test: PayrollRunDetailSchema's netAmount is already RUPEES
    // (payroll-service divides totalNetMinor by 100 before returning it), so
    // this table must NOT run it through formatMoney()/cellType:"amount" —
    // that treats the value as minor units and would show ₹900.00 instead of
    // the correct ₹90,000.00 on the screen used to confirm a bank transfer.
    mockResponses({
      runs: [
        { id: "r1", payPeriod: "2026-07", employeeCount: 10, grossAmount: 100000, netAmount: 90000, status: "completed" },
      ],
    });

    const ui = await DisbursementPage();
    render(ui);

    // The amount only renders as its own exact text node on the Preview
    // step's "Net Amount" table row (the step-0 dropdown option concatenates
    // it with the pay period into one string) -- advance the wizard the way
    // an officer actually would before checking it.
    fireEvent.click(screen.getByText("Next: Preview \u2192"));

    expect(screen.getByText("₹90,000.00")).toBeInTheDocument();
    expect(screen.queryByText("₹900.00")).not.toBeInTheDocument();
  });

  it("renders an empty state when there are no eligible runs", async () => {
    mockResponses({ runs: [] });

    const ui = await DisbursementPage();
    render(ui);

    expect(screen.getByText("No runs ready for a bank file")).toBeInTheDocument();
  });

  it("shows the error data-source badge when the API is unreachable", async () => {
    mockResponses({ source: "error" });

    const ui = await DisbursementPage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("notes the mandate list endpoint is not available, without fabricating data", async () => {
    mockResponses({});

    const ui = await DisbursementPage();
    render(ui);

    expect(screen.getByText("Mandate list not yet available")).toBeInTheDocument();
  });
});
