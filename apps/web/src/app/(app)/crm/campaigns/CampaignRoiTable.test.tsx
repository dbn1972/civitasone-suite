import { describe, it, expect } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import type { CRMCampaignRoiSummaryRow } from "@civitasone/types";
import { CampaignRoiTable } from "./CampaignRoiTable";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function row(overrides: Partial<CRMCampaignRoiSummaryRow> = {}): CRMCampaignRoiSummaryRow {
  return {
    campaignId: "11111111-1111-1111-1111-111111111111",
    currency: "INR",
    periods: 1,
    costMinor: "100000",
    revenueMinor: "250000",
    netMinor: "150000",
    responses: 10,
    roiPercent: "150.00",
    roiBasisPoints: "15000",
    costPerResponseMinor: "10000",
    ...overrides,
  };
}

describe("CampaignRoiTable naming (GAP-CRM-CAMPAIGNS-01)", () => {
  it("shows the campaign name as the primary label and the UUID only as secondary text", () => {
    render(<CampaignRoiTable rows={[row({ name: "Diwali Outreach" })]} />);
    expect(screen.getByText("Diwali Outreach")).toBeInTheDocument();
    // The id is still shown (for disambiguation) but is not the row's main label.
    expect(screen.getByText("11111111-1111-1111-1111-111111111111")).toBeInTheDocument();
  });

  it("falls back to 'Unnamed campaign' when the backend omits the name", () => {
    render(<CampaignRoiTable rows={[row()]} />);
    expect(screen.getByText("Unnamed campaign")).toBeInTheDocument();
  });

  it("offers a name-oriented filter placeholder", () => {
    render(<CampaignRoiTable rows={[row({ name: "Diwali Outreach" })]} />);
    expect(screen.getByPlaceholderText("Filter by campaign name")).toBeInTheDocument();
  });
});
