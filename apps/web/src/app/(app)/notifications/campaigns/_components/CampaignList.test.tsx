import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CampaignList } from "./CampaignList";
import * as api from "@/lib/notifications/campaigns";

vi.mock("@/lib/notifications/campaigns", async (orig) => {
  const actual = await orig<typeof import("@/lib/notifications/campaigns")>();
  return {
    ...actual,
    getCampaigns: vi.fn(),
    getCampaignTemplates: vi.fn(),
    getCampaignSegments: vi.fn(),
    createCampaign: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(api.getCampaigns).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(api.getCampaignTemplates).mockReset().mockResolvedValue({
    data: [{ id: "t1", name: "Welcome", channel: "email" }],
    source: "api",
  });
  vi.mocked(api.getCampaignSegments).mockReset().mockResolvedValue({
    data: [{ id: "s1", name: "VIP customers" }],
    source: "api",
  });
  vi.mocked(api.createCampaign).mockReset().mockResolvedValue(undefined);
});

describe("CampaignList (MK-001)", () => {
  it("renders campaign rows with budget via formatMoney", async () => {
    vi.mocked(api.getCampaigns).mockResolvedValue({
      data: [{ id: "c1", name: "Renewal push", objective: "conversion", status: "draft", budgetMinor: "500000" }],
      source: "api",
    });
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText("Renewal push")).toBeInTheDocument());
    expect(screen.getByText("₹5,000.00")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("shows an empty state when there are no campaigns", async () => {
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
  });

  it("shows the saved-information badge on a failed list load, not fabricated zeros", async () => {
    vi.mocked(api.getCampaigns).mockResolvedValue({ data: [], source: "error" });
    render(<CampaignList />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i).length).toBeGreaterThan(0));
    // must NOT claim "No campaigns yet" as fact when the fetch failed
    expect(screen.queryByText(/no campaigns yet/i)).not.toBeInTheDocument();
  });

  it("blocks create when required fields are missing (aria-invalid set)", async () => {
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new campaign/i }));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /create campaign/i }));
    expect(api.createCampaign).not.toHaveBeenCalled();
    const name = screen.getByLabelText("Name");
    expect(name).toHaveAttribute("aria-invalid", "true");
    const template = screen.getByLabelText("Template");
    expect(template).toHaveAttribute("aria-invalid", "true");
    const recipients = screen.getByLabelText("Recipients");
    expect(recipients).toHaveAttribute("aria-invalid", "true");
    // WCAG 3.3.1: each required field renders visible, associated error text on empty submit
    expect(screen.getByText(/a campaign name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/select a template to send/i)).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-describedby", screen.getByText(/a campaign name is required/i).id);
    expect(template).toHaveAttribute("aria-describedby", screen.getByText(/select a template to send/i).id);
  });

  it("converts the rupee budget to a paise string via money.ts (no float drift)", async () => {
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new campaign/i }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Spring blast" } });
    fireEvent.change(screen.getByLabelText("Template"), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText("Recipients"), { target: { value: "a@x.in, b@x.in" } });
    fireEvent.change(screen.getByLabelText(/budget/i), { target: { value: "1234.56" } });
    fireEvent.click(screen.getByRole("button", { name: /create campaign/i }));
    await waitFor(() =>
      expect(api.createCampaign).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Spring blast",
          templateId: "t1",
          recipients: ["a@x.in", "b@x.in"],
          budgetMinor: "123456",
          currency: "INR",
        }),
      ),
    );
  });

  it("rejects an over-precise budget without calling create", async () => {
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new campaign/i }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Bad budget" } });
    fireEvent.change(screen.getByLabelText("Template"), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText(/budget/i), { target: { value: "1.005" } });
    expect(screen.getByLabelText(/budget/i)).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: /create campaign/i }));
    expect(api.createCampaign).not.toHaveBeenCalled();
  });

  it("reloads the list after a successful create", async () => {
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    expect(api.getCampaigns).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /new campaign/i }));
    await screen.findByRole("dialog");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Reload me" } });
    fireEvent.change(screen.getByLabelText("Template"), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText("Recipients"), { target: { value: "one@x.in" } });
    fireEvent.click(screen.getByRole("button", { name: /create campaign/i }));
    await waitFor(() => expect(api.getCampaigns).toHaveBeenCalledTimes(2));
  });

  it("falls back to a free-text segment id when segments cannot be loaded", async () => {
    vi.mocked(api.getCampaignSegments).mockResolvedValue({ data: [], source: "error" });
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new campaign/i }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(screen.getByText(/segments could not be loaded/i)).toBeInTheDocument());
    // it is a text input, not fabricated options
    expect(screen.getByLabelText(/audience segment/i).tagName).toBe("INPUT");
  });
});
