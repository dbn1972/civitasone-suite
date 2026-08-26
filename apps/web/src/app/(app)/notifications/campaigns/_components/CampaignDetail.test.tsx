import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { CampaignDetail } from "./CampaignDetail";
import * as api from "@/lib/notifications/campaigns";

vi.mock("@/lib/notifications/campaigns", async (orig) => {
  const actual = await orig<typeof import("@/lib/notifications/campaigns")>();
  return {
    ...actual,
    getCampaign: vi.fn(),
    getCampaignMetrics: vi.fn(),
    sendCampaign: vi.fn(),
    cancelCampaign: vi.fn(),
  };
});

const CAMPAIGN = {
  id: "c1",
  name: "Renewal push",
  objective: "conversion",
  status: "draft",
  budgetMinor: "500000",
};

const METRICS = {
  campaignId: "c1",
  recipients: 100,
  delivered: 90,
  failed: 10,
  responses: 25,
  conversions: 8,
  budgetMinor: "500000",
  actualCostMinor: "400000",
  attributedRevenueMinor: "1200000",
  roiBps: 20000,
};

beforeEach(() => {
  vi.mocked(api.getCampaign).mockReset().mockResolvedValue({ data: CAMPAIGN, source: "api" });
  vi.mocked(api.getCampaignMetrics).mockReset().mockResolvedValue({ data: METRICS, source: "api" });
  vi.mocked(api.sendCampaign).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.cancelCampaign).mockReset().mockResolvedValue(undefined);
});

describe("CampaignDetail (MK-001 / MK-004)", () => {
  it("renders campaign fields and a metrics dashboard with a formatted ROI", async () => {
    render(<CampaignDetail campaignId="c1" />);
    await waitFor(() => expect(screen.getByText("Renewal push")).toBeInTheDocument());
    expect(screen.getByText("Recipients")).toBeInTheDocument();
    expect(screen.getByText("Conversions")).toBeInTheDocument();
    expect(screen.getByText("₹12,000.00")).toBeInTheDocument(); // attributed revenue
    expect(screen.getByText("+200.0%")).toBeInTheDocument(); // ROI from 20000 bps
  });

  it("shows ROI as an em dash (never 0%) when roiBps is null", async () => {
    vi.mocked(api.getCampaignMetrics).mockResolvedValue({
      data: { ...METRICS, actualCostMinor: "0", roiBps: null },
      source: "api",
    });
    render(<CampaignDetail campaignId="c1" />);
    await waitFor(() => expect(screen.getByText("ROI")).toBeInTheDocument());
    const roiTile = screen.getByText("ROI").closest(".card");
    expect(roiTile).toHaveTextContent("—");
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });

  it("shows the saved-information badge on a failed metrics load, not fabricated zeros", async () => {
    vi.mocked(api.getCampaignMetrics).mockResolvedValue({ data: null, source: "error" });
    render(<CampaignDetail campaignId="c1" />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i).length).toBeGreaterThan(0));
    // no fabricated "Recipients 0" tile when metrics failed
    expect(screen.queryByText("Recipients")).not.toBeInTheDocument();
  });

  it("routes Send through a ConfirmDialog before calling the API", async () => {
    render(<CampaignDetail campaignId="c1" />);
    await waitFor(() => expect(screen.getByText("Renewal push")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    // confirm dialog appears; API not yet called
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(api.sendCampaign).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /send campaign/i }));
    await waitFor(() => expect(api.sendCampaign).toHaveBeenCalledWith("c1"));
  });

  it("routes Cancel through a ConfirmDialog and reloads after success", async () => {
    render(<CampaignDetail campaignId="c1" />);
    await waitFor(() => expect(screen.getByText("Renewal push")).toBeInTheDocument());
    expect(api.getCampaign).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /cancel campaign/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /cancel campaign/i }));
    await waitFor(() => expect(api.cancelCampaign).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(api.getCampaign).toHaveBeenCalledTimes(2));
  });

  it("disables Send once a campaign is already sent", async () => {
    vi.mocked(api.getCampaign).mockResolvedValue({ data: { ...CAMPAIGN, status: "sent" }, source: "api" });
    render(<CampaignDetail campaignId="c1" />);
    await waitFor(() => expect(screen.getByText("Renewal push")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
  });

  it("gates campaign fields on a failed load", async () => {
    vi.mocked(api.getCampaign).mockResolvedValue({ data: null, source: "error" });
    render(<CampaignDetail campaignId="c1" />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i).length).toBeGreaterThan(0));
  });
});
