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
    getCampaignSegments: vi.fn(),
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
  audienceSegmentId: "seg-1",
  scheduledAt: "2024-01-15T19:00:00.000Z",
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
  vi.mocked(api.getCampaignSegments)
    .mockReset()
    .mockResolvedValue({ data: [{ id: "seg-1", name: "VIP customers" }], source: "api" });
  vi.mocked(api.sendCampaign).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.cancelCampaign).mockReset().mockResolvedValue(undefined);
});

describe("CampaignDetail (MK-001 / MK-004)", () => {
  it("renders campaign fields and a metrics dashboard with a formatted ROI", async () => {
    render(<CampaignDetail campaignId="c1" canManage />);
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
    render(<CampaignDetail campaignId="c1" canManage />);
    await waitFor(() => expect(screen.getByText("ROI")).toBeInTheDocument());
    const roiTile = screen.getByText("ROI").closest(".card");
    expect(roiTile).toHaveTextContent("—");
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("0.0%")).not.toBeInTheDocument();
  });

  // GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-05: resolves the segment NAME, not the id.
  it("shows the audience segment name, not the raw id", async () => {
    render(<CampaignDetail campaignId="c1" canManage />);
    await waitFor(() => expect(screen.getByText("VIP customers")).toBeInTheDocument());
    expect(screen.queryByText("seg-1")).not.toBeInTheDocument();
  });

  it("falls back to the raw segment id when the segment lookup fails", async () => {
    vi.mocked(api.getCampaignSegments).mockResolvedValue({ data: [], source: "error" });
    render(<CampaignDetail campaignId="c1" canManage />);
    await waitFor(() => expect(screen.getByText("seg-1")).toBeInTheDocument());
  });

  // GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-03: scheduled/created show hh:mm IST.
  it("shows a scheduled time, not just the date", async () => {
    render(<CampaignDetail campaignId="c1" canManage />);
    // 2024-01-15T19:00:00Z -> 16 Jan 2024, 12:30 am IST
    await waitFor(() => expect(screen.getByText(/16 Jan 2024, 12:30/i)).toBeInTheDocument());
  });

  // GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-02: a transient failure shows a real
  // ErrorState with Retry — never "showing saved information".
  it("shows an honest error with Retry on a failed campaign load (no saved-information lie)", async () => {
    vi.mocked(api.getCampaign).mockResolvedValue({ data: null, source: "error" });
    render(<CampaignDetail campaignId="c1" canManage />);
    await waitFor(() => expect(screen.getByText(/we couldn.t load/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/showing saved information/i)).not.toBeInTheDocument();
  });

  it("retrying refetches the campaign", async () => {
    vi.mocked(api.getCampaign).mockResolvedValueOnce({ data: null, source: "error" });
    render(<CampaignDetail campaignId="c1" canManage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument());
    vi.mocked(api.getCampaign).mockResolvedValue({ data: CAMPAIGN, source: "api" });
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("Renewal push")).toBeInTheDocument());
  });

  // GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-02: a 404 is distinct from a failed load.
  it("shows a distinct 'Campaign not found' state on 404 with no Retry", async () => {
    vi.mocked(api.getCampaign).mockResolvedValue({ data: null, source: "error", notFound: true });
    render(<CampaignDetail campaignId="c1" canManage />);
    await waitFor(() => expect(screen.getByText(/campaign not found/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go back/i })).toHaveAttribute("href", "/notifications/campaigns");
  });

  it("shows a 'metrics appear after the first send' note for an unsent draft (not zeros)", async () => {
    vi.mocked(api.getCampaignMetrics).mockResolvedValue({
      data: { ...METRICS, recipients: 0, delivered: 0, failed: 0, responses: 0, conversions: 0 },
      source: "api",
    });
    render(<CampaignDetail campaignId="c1" canManage />);
    await waitFor(() => expect(screen.getByText(/metrics appear after the first send/i)).toBeInTheDocument());
    expect(screen.queryByText("Recipients")).not.toBeInTheDocument();
  });

  it("routes Send through a ConfirmDialog that states the audience size", async () => {
    render(<CampaignDetail campaignId="c1" canManage />);
    await waitFor(() => expect(screen.getByText("Renewal push")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/100 recipients/i);
    expect(api.sendCampaign).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: /send campaign/i }));
    await waitFor(() => expect(api.sendCampaign).toHaveBeenCalledWith("c1"));
  });

  it("the confirm dialog's dismiss button reads 'Go back', not 'Keep editing'", async () => {
    render(<CampaignDetail campaignId="c1" canManage />);
    await waitFor(() => expect(screen.getByText("Renewal push")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: /go back/i })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /keep editing/i })).not.toBeInTheDocument();
  });

  // GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-01: no management controls for a plain viewer.
  it("hides Send/Cancel entirely for a user who cannot manage campaigns", async () => {
    render(<CampaignDetail campaignId="c1" canManage={false} />);
    await waitFor(() => expect(screen.getByText("Renewal push")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^send$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel campaign/i })).not.toBeInTheDocument();
  });

  // GAP-NOTIFICATIONS-CAMPAIGNS-DETAIL-04: a sending campaign cannot be cancelled
  // (no backend recall), and the disabled state is explained.
  it("disables Cancel for a 'sending' campaign and explains why", async () => {
    vi.mocked(api.getCampaign).mockResolvedValue({ data: { ...CAMPAIGN, status: "sending" }, source: "api" });
    render(<CampaignDetail campaignId="c1" canManage />);
    await waitFor(() => expect(screen.getByText("Renewal push")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /cancel campaign/i })).toBeDisabled();
    expect(screen.getByText(/cannot be recalled/i)).toBeInTheDocument();
  });

  it("routes Cancel through a ConfirmDialog and reloads after success", async () => {
    render(<CampaignDetail campaignId="c1" canManage />);
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
    render(<CampaignDetail campaignId="c1" canManage />);
    await waitFor(() => expect(screen.getByText("Renewal push")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
  });

  it("shows an honest error on a failed metrics load (no saved-information lie)", async () => {
    vi.mocked(api.getCampaignMetrics).mockResolvedValue({ data: null, source: "error" });
    render(<CampaignDetail campaignId="c1" canManage />);
    await waitFor(() => expect(screen.getByText(/we couldn.t load campaign metrics/i)).toBeInTheDocument());
    expect(screen.queryByText(/showing saved information/i)).not.toBeInTheDocument();
  });
});
