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

describe("CampaignRoiTable export notice (GAP-CRM-CAMPAIGNS-05)", () => {
  it("shows a policy notice next to the CSV export button", () => {
    render(<CampaignRoiTable rows={[row({ name: "Diwali Outreach" })]} />);
    expect(screen.getByRole("button", { name: /CSV/ })).toBeInTheDocument();
    expect(
      screen.getByText(/Exports leave the system; handle spend and revenue figures per policy\./),
    ).toBeInTheDocument();
  });
});

describe("CampaignRoiTable per-row currency (GAP-CRM-CAMPAIGNS-DETAIL-03)", () => {
  it("formats a USD row in dollars with no rupee symbol, and an INR row in rupees", () => {
    const { container } = render(
      <CampaignRoiTable
        rows={[
          row({ campaignId: "usd-1", name: "Global Webinar", currency: "USD", costMinor: "12345", revenueMinor: "50000", netMinor: "37655", costPerResponseMinor: "1234" }),
          row({ campaignId: "inr-1", name: "Diwali Outreach", currency: "INR", costMinor: "100000", revenueMinor: "250000", netMinor: "150000" }),
        ]}
      />,
    );
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    const usdRow = rows.find((r) => r.textContent?.includes("Global Webinar"));
    const inrRow = rows.find((r) => r.textContent?.includes("Diwali Outreach"));
    expect(usdRow).toBeTruthy();
    expect(inrRow).toBeTruthy();
    expect(usdRow!.textContent).toContain("$123.45");
    expect(usdRow!.textContent).toContain("$376.55");
    expect(usdRow!.textContent).toContain("$12.34");
    expect(usdRow!.textContent).not.toContain("₹");
    expect(inrRow!.textContent).toContain("₹");
  });
});
