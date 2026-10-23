import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
    searchCampaignContacts: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(api.getCampaigns).mockReset().mockResolvedValue({ data: [], total: 0, source: "api" });
  vi.mocked(api.getCampaignTemplates).mockReset().mockResolvedValue({
    data: [{ id: "t1", name: "Welcome", channel: "email" }],
    source: "api",
  });
  vi.mocked(api.getCampaignSegments).mockReset().mockResolvedValue({
    data: [{ id: "s1", name: "VIP customers" }],
    source: "api",
  });
  vi.mocked(api.createCampaign).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.searchCampaignContacts).mockReset().mockResolvedValue([]);
});

const CONTACT_A = "3f2a1c9e-8b4d-4e7a-9c11-0a1b2c3d4e5f";
const CONTACT_B = "7d6e5f4a-1b2c-4d3e-8f90-a1b2c3d4e5f6";

async function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: /new campaign/i }));
  return screen.findByRole("dialog");
}

describe("CampaignList (MK-001)", () => {
  it("renders campaign rows with budget via formatMoney", async () => {
    vi.mocked(api.getCampaigns).mockResolvedValue({
      data: [{ id: "c1", name: "Renewal push", objective: "conversion", status: "draft", budgetMinor: "500000" }],
      total: 1,
      source: "api",
    });
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText("Renewal push")).toBeInTheDocument());
    expect(screen.getByText("₹5,000.00")).toBeInTheDocument();
    // "Draft" also appears as a filter tab, so scope to the row's status cell.
    const row = screen.getByText("Renewal push").closest("tr")!;
    expect(within(row).getByText("Draft")).toBeInTheDocument();
  });

  // GAP-NOTIFICATIONS-CAMPAIGNS-03: no "ROI" header without ROI values; a single
  // "Open" action per row (no duplicate "View metrics" link).
  it("has no ROI column and does not triple-link each row", async () => {
    vi.mocked(api.getCampaigns).mockResolvedValue({
      data: [{ id: "c1", name: "Renewal push", status: "draft", budgetMinor: "500000" }],
      total: 1,
      source: "api",
    });
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText("Renewal push")).toBeInTheDocument());
    expect(screen.queryByRole("columnheader", { name: /^roi$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /view metrics/i })).not.toBeInTheDocument();
    const row = screen.getByText("Renewal push").closest("tr")!;
    const links = within(row).getAllByRole("link");
    expect(links.length).toBeLessThanOrEqual(2);
  });

  it("shows an empty state when there are no campaigns", async () => {
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
  });

  // GAP-NOTIFICATIONS-CAMPAIGNS-01: a failed list shows a real error + Retry,
  // NEVER "showing saved information", and never "No campaigns yet".
  it("shows an honest error with Retry on a failed list load", async () => {
    vi.mocked(api.getCampaigns).mockResolvedValue({ data: [], source: "error" });
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/we couldn.t load campaigns/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/showing saved information/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no campaigns yet/i)).not.toBeInTheDocument();
  });

  // GAP-NOTIFICATIONS-CAMPAIGNS-05: status filter present.
  it("filters the list by status", async () => {
    vi.mocked(api.getCampaigns).mockResolvedValue({
      data: [
        { id: "c1", name: "Draft one", status: "draft", createdAt: "2026-01-02T00:00:00Z" },
        { id: "c2", name: "Sent one", status: "sent", createdAt: "2026-01-01T00:00:00Z" },
      ],
      total: 2,
      source: "api",
    });
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText("Draft one")).toBeInTheDocument());
    expect(screen.getByText("Sent one")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Draft" }));
    await waitFor(() => expect(screen.queryByText("Sent one")).not.toBeInTheDocument());
    expect(screen.getByText("Draft one")).toBeInTheDocument();
  });

  // GAP-NOTIFICATIONS-CAMPAIGNS-05: pager appears and advances the offset.
  it("pages forward using the API total", async () => {
    const page1 = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, status: "sent" as const }));
    vi.mocked(api.getCampaigns).mockResolvedValue({ data: page1, total: 120, source: "api" });
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/showing 1–50 of 120/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(api.getCampaigns).toHaveBeenCalledWith(50, 50));
  });

  it("blocks create when required fields are missing (aria-invalid set)", async () => {
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: /create campaign/i }));
    expect(api.createCampaign).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Name(\s*\*)?$/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/^Template(\s*\*)?$/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/^Recipients(\s*\*)?$/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/a campaign name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/select a template to send/i)).toBeInTheDocument();
  });

  // GAP-NOTIFICATIONS-CAMPAIGNS-02: a bad recipient token blocks submit.
  it("rejects an invalid recipient token and does not call create", async () => {
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    await openDialog();
    fireEvent.change(screen.getByLabelText(/^Name(\s*\*)?$/), { target: { value: "Bad list" } });
    fireEvent.change(screen.getByLabelText(/^Template(\s*\*)?$/), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText(/^Recipients(\s*\*)?$/), { target: { value: "abc, nope" } });
    fireEvent.click(screen.getByRole("button", { name: /create campaign/i }));
    expect(api.createCampaign).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/^Recipients(\s*\*)?$/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/must be a crm contact id/i)).toBeInTheDocument();
  });

  // Recipients are CRM contact ids: the consent check only resolves ids, so an
  // email/phone/handle would be created and then never send.
  it.each(["asha@example.gov.in", "9876543210", "user-7f3a"])("rejects %s as a recipient (must be a contact id) and does not call create", async (token) => {
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    await openDialog();
    fireEvent.change(screen.getByLabelText(/^Name(\s*\*)?$/), { target: { value: "Raw contact" } });
    fireEvent.change(screen.getByLabelText(/^Template(\s*\*)?$/), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText(/^Recipients(\s*\*)?$/), { target: { value: token } });
    fireEvent.click(screen.getByRole("button", { name: /create campaign/i }));
    expect(api.createCampaign).not.toHaveBeenCalled();
    expect(screen.getByText(/must be a crm contact id/i)).toBeInTheDocument();
  });

  it("Find contacts looks up CRM contacts and Add puts the contact id into the recipients", async () => {
    vi.mocked(api.searchCampaignContacts).mockResolvedValue([
      { id: CONTACT_A, name: "Asha Rao", company: "Zilla Parishad", email: "a***@example.gov.in", phone: "98******10" },
    ]);
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    await openDialog();
    fireEvent.change(screen.getByLabelText("Search CRM contacts"), { target: { value: "asha" } });
    fireEvent.click(screen.getByRole("button", { name: /find contacts/i }));
    expect(await screen.findByText(/Asha Rao/)).toBeInTheDocument();
    expect(api.searchCampaignContacts).toHaveBeenCalledWith("asha");
    fireEvent.click(screen.getByRole("button", { name: /add asha rao/i }));
    expect(screen.getByLabelText(/^Recipients(\s*\*)?$/)).toHaveValue(CONTACT_A);
    expect(screen.getByRole("button", { name: /add asha rao/i })).toBeDisabled(); // no duplicate adds
    expect(screen.getByText(/1 recipient/)).toBeInTheDocument();
  });

  it("says so when contact search is unavailable (not 'no matches')", async () => {
    vi.mocked(api.searchCampaignContacts).mockResolvedValue(null);
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    await openDialog();
    fireEvent.change(screen.getByLabelText("Search CRM contacts"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /find contacts/i }));
    expect(await screen.findByText(/contact search is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/no matching contacts/i)).not.toBeInTheDocument();
  });

  // GAP-NOTIFICATIONS-CAMPAIGNS-02: DPDP consent notice is present.
  it("shows a consent/opt-out notice next to the recipients field", async () => {
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    await openDialog();
    expect(screen.getByText(/only contact people who have consented/i)).toBeInTheDocument();
  });

  it("accepts a CRM contact id list and converts the rupee budget to paise (no float drift)", async () => {
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    await openDialog();
    fireEvent.change(screen.getByLabelText(/^Name(\s*\*)?$/), { target: { value: "Spring blast" } });
    fireEvent.change(screen.getByLabelText(/^Template(\s*\*)?$/), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText(/^Recipients(\s*\*)?$/), { target: { value: `${CONTACT_A}, ${CONTACT_B}` } });
    fireEvent.change(screen.getByLabelText(/budget/i), { target: { value: "1234.56" } });
    fireEvent.click(screen.getByRole("button", { name: /create campaign/i }));
    await waitFor(() =>
      expect(api.createCampaign).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Spring blast",
          templateId: "t1",
          recipients: [CONTACT_A, CONTACT_B],
          budgetMinor: "123456",
          currency: "INR",
        }),
      ),
    );
  });

  it("rejects an over-precise budget without calling create", async () => {
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    await openDialog();
    fireEvent.change(screen.getByLabelText(/^Name(\s*\*)?$/), { target: { value: "Bad budget" } });
    fireEvent.change(screen.getByLabelText(/^Template(\s*\*)?$/), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText(/budget/i), { target: { value: "1.005" } });
    expect(screen.getByLabelText(/budget/i)).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: /create campaign/i }));
    expect(api.createCampaign).not.toHaveBeenCalled();
  });

  it("reloads the list after a successful create", async () => {
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    expect(api.getCampaigns).toHaveBeenCalledTimes(1);
    await openDialog();
    fireEvent.change(screen.getByLabelText(/^Name(\s*\*)?$/), { target: { value: "Reload me" } });
    fireEvent.change(screen.getByLabelText(/^Template(\s*\*)?$/), { target: { value: "t1" } });
    fireEvent.change(screen.getByLabelText(/^Recipients(\s*\*)?$/), { target: { value: CONTACT_A } });
    fireEvent.click(screen.getByRole("button", { name: /create campaign/i }));
    await waitFor(() => expect(api.getCampaigns).toHaveBeenCalledTimes(2));
  });

  // GAP-NOTIFICATIONS-CAMPAIGNS-04: a dirty form prompts before discarding.
  it("prompts to discard a dirty form instead of closing silently", async () => {
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    await openDialog();
    fireEvent.change(screen.getByLabelText(/^Name(\s*\*)?$/), { target: { value: "Half typed" } });
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(await screen.findByText(/discard this campaign\?/i)).toBeInTheDocument();
    // keep editing retains the form
    fireEvent.click(screen.getByRole("button", { name: /keep editing/i }));
    await waitFor(() => expect(screen.queryByText(/discard this campaign\?/i)).not.toBeInTheDocument());
    expect(screen.getByLabelText(/^Name(\s*\*)?$/)).toHaveValue("Half typed");
  });

  it("falls back to a free-text segment id when segments cannot be loaded", async () => {
    vi.mocked(api.getCampaignSegments).mockResolvedValue({ data: [], source: "error" });
    render(<CampaignList />);
    await waitFor(() => expect(screen.getByText(/no campaigns yet/i)).toBeInTheDocument());
    await openDialog();
    await waitFor(() => expect(screen.getByText(/segments could not be loaded/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/audience segment/i).tagName).toBe("INPUT");
  });
});
