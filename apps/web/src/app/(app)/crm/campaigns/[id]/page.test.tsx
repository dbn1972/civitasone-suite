import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import type { CRMCampaignRoi } from "@civitasone/types";

vi.mock("../../../../_data/loaders", () => ({ getCrmCampaignRoi: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => mockRoles() };
});

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

beforeEach(() => {
  mocked.mockReset();
  // The write behind the post-period form is crm_admin / super_admin / tenant_admin only.
  mockRoles.mockReset();
  mockRoles.mockReturnValue(["crm_admin"]);
});

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

  it("GAP-CRM-CAMPAIGNS-DETAIL-04: the 404 branch offers the form to each role the write admits", async () => {
    mocked.mockResolvedValue({ data: null, source: "error", status: 404 });
    for (const role of ["crm_admin", "super_admin", "tenant_admin"]) {
      mockRoles.mockReturnValue([role]);
      const { unmount } = renderWithIntl(await Page({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } }));
      expect(screen.getByRole("form", { name: /post a reporting period/i })).toBeInTheDocument();
      expect(screen.getByText(/Use the form below/)).toBeInTheDocument();
      unmount();
    }
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-04: a role the write rejects (crm_user) sees no form and no 'use the form below'", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    mocked.mockResolvedValue({ data: null, source: "error", status: 404 });
    renderWithIntl(await Page({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } }));

    expect(screen.getByText("No performance recorded")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /post a reporting period/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Use the form below/)).not.toBeInTheDocument();
    expect(screen.getByText(/A CRM administrator can post its first reporting period/)).toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-04: roles in the wider CRM admin set that the write 403s (admin, platform_admin) see no form", async () => {
    mocked.mockResolvedValue({ data: null, source: "error", status: 404 });
    for (const role of ["admin", "platform_admin"]) {
      mockRoles.mockReturnValue([role]);
      const { unmount } = renderWithIntl(await Page({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } }));
      expect(screen.queryByRole("form", { name: /post a reporting period/i })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-04: the 404 branch never builds the form around a non-UUID URL segment", async () => {
    mocked.mockResolvedValue({ data: null, source: "error", status: 404 });
    renderWithIntl(await Page({ params: { id: "../../v1/admin/x" } }));

    expect(screen.getByText("No performance recorded")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /post a reporting period/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Use the form below/)).not.toBeInTheDocument();
  });

  it("GAP-CRM-CAMPAIGNS-DETAIL-04: a campaign with figures hides the post form from a non-admin viewer", async () => {
    mockRoles.mockReturnValue(["crm_user"]);
    mocked.mockResolvedValue({ data: campaign(), source: "api" });
    renderWithIntl(await Page({ params: { id: "7f3a1c2e-0000-4000-8000-000000000000" } }));

    expect(screen.getByText("Period Breakdown")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /post a reporting period/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /post period/i })).not.toBeInTheDocument();
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
