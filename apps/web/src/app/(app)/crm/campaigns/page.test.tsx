import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CRMCampaignRoiSummaryRow } from "@civitasone/types";

vi.mock("../../../_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("../../../_data/loaders")>("../../../_data/loaders");
  return { ...actual, getCrmCampaignRoiSummary: vi.fn() };
});
vi.mock("./CampaignRoiTable", () => ({ CampaignRoiTable: () => <div data-testid="roi-table" /> }));

import Page from "./page";
import { getCrmCampaignRoiSummary } from "../../../_data/loaders";

const mocked = vi.mocked(getCrmCampaignRoiSummary);

function row(overrides: Partial<CRMCampaignRoiSummaryRow> = {}): CRMCampaignRoiSummaryRow {
  return {
    campaignId: "11111111-1111-1111-1111-111111111111",
    currency: "INR",
    periods: 1,
    costMinor: "100000",
    revenueMinor: "150000",
    netMinor: "50000",
    responses: 10,
    roiBasisPoints: "5000",
    roiPercent: "50.00",
    costPerResponseMinor: "10000",
    ...overrides,
  };
}

beforeEach(() => mocked.mockReset());

describe("Campaigns list page", () => {
  it("GAP-CRM-CAMPAIGNS-02: a failed load shows retry, not ₹0.00 or 'No campaign spend recorded'", async () => {
    mocked.mockResolvedValue({ data: { rows: [], total: 0 }, source: "error", status: 500 });
    render(await Page());

    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("No campaign spend recorded")).not.toBeInTheDocument();
    expect(screen.queryByTestId("roi-table")).not.toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-02: an empty-but-successful load shows 0 and ₹0.00 with the table", async () => {
    mocked.mockResolvedValue({ data: { rows: [], total: 0 }, source: "api" });
    render(await Page());

    expect(screen.getByText("Campaigns Tracked")).toBeInTheDocument();
    expect(screen.getByTestId("roi-table")).toBeInTheDocument();
    // zero spend renders as the real ₹0.00, not an error
    expect(screen.getAllByText("₹0.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-03: shows a partial-totals banner when total exceeds the page", async () => {
    mocked.mockResolvedValue({
      data: { rows: Array.from({ length: 200 }, (_, i) => row({ campaignId: `c${i}` })), total: 350 },
      source: "api",
    });
    render(await Page());

    expect(screen.getByLabelText("Partial totals notice")).toHaveTextContent(/first 200 of 350 campaigns/i);
  });

  it("GAP-CRM-CAMPAIGNS-03: shows no banner when total fits in the page", async () => {
    mocked.mockResolvedValue({ data: { rows: [row()], total: 1 }, source: "api" });
    render(await Page());

    expect(screen.queryByLabelText("Partial totals notice")).not.toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-04: notes campaigns excluded from ROI when some have no spend", async () => {
    mocked.mockResolvedValue({
      data: {
        rows: [
          row({ campaignId: "m", costMinor: "100", revenueMinor: "200", netMinor: "100" }),
          row({ campaignId: "u", costMinor: "0", revenueMinor: "500", netMinor: "500" }),
        ],
        total: 2,
      },
      source: "api",
    });
    render(await Page());

    expect(screen.getByText(/ROI excludes 1 campaign with no spend recorded/i)).toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-03: does not sum spend across mixed currencies", async () => {
    mocked.mockResolvedValue({
      data: {
        rows: [row({ campaignId: "inr", currency: "INR" }), row({ campaignId: "usd", currency: "USD" })],
        total: 2,
      },
      source: "api",
    });
    render(await Page());

    expect(screen.getByLabelText("Mixed currency notice")).toBeInTheDocument();
  });
});
