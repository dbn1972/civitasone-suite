import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CRMCampaignRoi } from "@civitasone/types";

vi.mock("../../../../_data/loaders", () => ({ getCrmCampaignRoi: vi.fn() }));

import Page from "./page";
import { getCrmCampaignRoi } from "../../../../_data/loaders";

const mocked = vi.mocked(getCrmCampaignRoi);

function campaign(overrides: Partial<CRMCampaignRoi> = {}): CRMCampaignRoi {
  return {
    campaignId: "7f3a1c2e-0000-4000-8000-000000000000",
    currency: "INR",
    costMinor: "100000",
    revenueMinor: "250000",
    netMinor: "150000",
    responses: 20,
    roiBasisPoints: "15000",
    roiPercent: "150.00",
    costPerResponseMinor: "5000",
    periods: [],
    ...overrides,
  };
}

beforeEach(() => mocked.mockReset());

describe("Campaign detail page", () => {
  it("GAP-CRM-CAMPAIGNS-DETAIL-01: shows the campaign name as the h1 when present", async () => {
    mocked.mockResolvedValue({ data: campaign({ name: "Diwali Push" }), source: "api" });
    render(await Page({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } }));

    expect(screen.getByRole("heading", { name: "Diwali Push" })).toBeInTheDocument();
    // the full UUID is no longer the title
    expect(screen.queryByRole("heading", { name: /7f3a1c2e-0000/ })).not.toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-01: falls back to 'Campaign' + short id when no name", async () => {
    mocked.mockResolvedValue({ data: campaign(), source: "api" });
    render(await Page({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } }));

    expect(screen.getByRole("heading", { name: "Campaign" })).toBeInTheDocument();
    expect(screen.getByText(/Campaign 7f3a1c2e · INR/)).toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-02: a 404 shows the empty state, no retry", async () => {
    mocked.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await Page({ params: { id: "x" } }));

    expect(screen.getByText("No performance recorded")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-02: a 500 shows the retry error state, not 'no figures'", async () => {
    mocked.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await Page({ params: { id: "x" } }));

    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("No performance recorded")).not.toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-02: a 403 shows a permission-denied state", async () => {
    mocked.mockResolvedValue({ data: null, source: "error", status: 403, errorMessage: "requires crm_admin" });
    render(await Page({ params: { id: "x" } }));

    expect(screen.queryByText("No performance recorded")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /access restricted/i })).toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-03: formats amounts in a non-INR currency without ₹", async () => {
    mocked.mockResolvedValue({ data: campaign({ currency: "USD" }), source: "api" });
    render(await Page({ params: { id: "x" } }));

    // Spend 100000 cents == $1,000.00
    expect(screen.getByText("$1,000.00")).toBeInTheDocument();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });
});
