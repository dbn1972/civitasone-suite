import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import type { CRMCampaignRoi } from "@civitasone/types";

vi.mock("../../../../_data/loaders", () => ({ getCrmCampaignRoi: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import Page, { generateMetadata } from "./page";
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
    renderWithIntl(await Page({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } }));

    expect(screen.getByRole("heading", { name: "Diwali Push" })).toBeInTheDocument();
    // the full UUID is no longer the title
    expect(screen.queryByRole("heading", { name: /7f3a1c2e-0000/ })).not.toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-01: falls back to 'Campaign' + short id when no name", async () => {
    mocked.mockResolvedValue({ data: campaign(), source: "api" });
    renderWithIntl(await Page({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } }));

    expect(screen.getByRole("heading", { name: "Campaign" })).toBeInTheDocument();
    expect(screen.getByText(/Campaign 7f3a1c2e · INR/)).toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-01: the browser tab title is the campaign name, else 'Campaign'", async () => {
    mocked.mockResolvedValue({ data: campaign({ name: "Diwali Push" }), source: "api" });
    expect((await generateMetadata({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } })).title).toBe(
      "Diwali Push — CivitasOne CRM",
    );
    mocked.mockResolvedValue({ data: campaign(), source: "api" });
    expect((await generateMetadata({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } })).title).toBe(
      "Campaign — CivitasOne CRM",
    );
    // An outage / unknown campaign still yields a neutral title, never the id.
    mocked.mockResolvedValue({ data: null, source: "error", status: 404 });
    expect((await generateMetadata({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } })).title).toBe(
      "Campaign — CivitasOne CRM",
    );
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-01: shows only a short id on screen, with a button that copies the full id", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mocked.mockResolvedValue({ data: campaign(), source: "api" });
    renderWithIntl(await Page({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } }));

    // The full UUID is not printed as text anywhere on the page.
    expect(screen.queryByText("7f3a1c2e-0000-4000-8000-000000000000")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy the full campaign ID" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("7f3a1c2e-0000-4000-8000-000000000000"));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-01: the post-period form is pre-filled with the campaign's name", async () => {
    mocked.mockResolvedValue({ data: campaign({ name: "Diwali Push" }), source: "api" });
    renderWithIntl(await Page({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } }));
    expect(screen.getByLabelText("Campaign name (optional)")).toHaveValue("Diwali Push");
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-02: a 404 shows the empty state, no retry", async () => {
    mocked.mockResolvedValue({ data: null, source: "error", status: 404 });
    renderWithIntl(await Page({ params: { id: "x" } }));

    expect(screen.getByText("No performance recorded")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-02: a 500 shows the retry error state, not 'no figures'", async () => {
    mocked.mockResolvedValue({ data: null, source: "error", status: 500 });
    renderWithIntl(await Page({ params: { id: "x" } }));

    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("No performance recorded")).not.toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-02: a 403 shows a permission-denied state", async () => {
    mocked.mockResolvedValue({ data: null, source: "error", status: 403, errorMessage: "requires crm_admin" });
    renderWithIntl(await Page({ params: { id: "x" } }));

    expect(screen.queryByText("No performance recorded")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /access restricted/i })).toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-03: formats amounts in a non-INR currency without ₹", async () => {
    mocked.mockResolvedValue({ data: campaign({ currency: "USD" }), source: "api" });
    renderWithIntl(await Page({ params: { id: "x" } }));

    // Spend 100000 cents == $1,000.00
    expect(screen.getByText("$1,000.00")).toBeInTheDocument();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-04: offers a form to post a reporting period", async () => {
    mocked.mockResolvedValue({ data: campaign(), source: "api" });
    renderWithIntl(await Page({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } }));

    expect(screen.getByRole("form", { name: /post a reporting period/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /post period/i })).toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-04: a campaign with no figures (404) still offers the form for its first period", async () => {
    mocked.mockResolvedValue({ data: null, source: "error", status: 404 });
    renderWithIntl(await Page({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } }));

    expect(screen.getByText("No performance recorded")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: /post a reporting period/i })).toBeInTheDocument();
    // currency is unknown for a brand-new campaign, so it is editable and defaults to INR
    expect(screen.getByLabelText(/^Currency/)).toHaveValue("INR");
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-04: a 500 does not offer the post form", async () => {
    mocked.mockResolvedValue({ data: null, source: "error", status: 500 });
    renderWithIntl(await Page({ params: { id: "x" } }));

    expect(screen.queryByRole("form", { name: /post a reporting period/i })).not.toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-04: the empty period table does not tell the reader to post", async () => {
    mocked.mockResolvedValue({ data: campaign({ periods: [] }), source: "api" });
    renderWithIntl(await Page({ params: { id: "x" } }));

    expect(screen.getByText("No reporting periods have been recorded for this campaign.")).toBeInTheDocument();
    expect(screen.queryByText(/Post a reporting period's cost and revenue/)).not.toBeInTheDocument();
  });
});
