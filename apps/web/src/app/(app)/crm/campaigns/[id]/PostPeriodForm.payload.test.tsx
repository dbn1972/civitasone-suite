import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { PostPeriodForm } from "./PostPeriodForm";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

// Unlike PostPeriodForm.test.tsx this suite does NOT mock postCampaignPeriod:
// it drives the real form -> buildPerformanceBody -> PUT path and asserts the
// bytes that leave the browser (GAP-CRM-CAMPAIGNS-DETAIL-04).
const fetchMock = vi.fn();

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ accepted: true }), { status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("PostPeriodForm request payload (GAP-CRM-CAMPAIGNS-DETAIL-04)", () => {
  it("sends spend 1500.50 as costMinor '150050' via PUT to the performance endpoint, then refreshes", async () => {
    renderWithIntl(<PostPeriodForm campaignId="c-123" currency="INR" />);

    fireEvent.change(screen.getByLabelText(/^Period start/), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Spend (INR)"), { target: { value: "1500.50" } });
    fireEvent.change(screen.getByLabelText("Revenue (INR)"), { target: { value: "2000" } });
    fireEvent.change(screen.getByLabelText("Responses"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Post period" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/crm/campaigns/c-123/performance");
    expect(init.method).toBe("PUT");
    expect(sentBody()).toEqual({
      periodStart: "2026-08-01",
      costMinor: "150050",
      revenueMinor: "200000",
      responses: 12,
      currency: "INR",
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("percent-encodes the campaign id in the request path (it can be a raw URL segment)", async () => {
    renderWithIntl(<PostPeriodForm campaignId="a/b?c#d" currency="INR" />);

    fireEvent.change(screen.getByLabelText(/^Period start/), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Spend (INR)"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Revenue (INR)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Post period" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/crm/campaigns/a%2Fb%3Fc%23d/performance");
  });

  it("blocks a sub-paise amount before any request is made", async () => {
    renderWithIntl(<PostPeriodForm campaignId="c-123" currency="INR" />);

    fireEvent.change(screen.getByLabelText(/^Period start/), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Spend (INR)"), { target: { value: "1.005" } });
    fireEvent.change(screen.getByLabelText("Revenue (INR)"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Post period" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/two decimal places/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows no currency field for an existing campaign (its currency is fixed)", () => {
    renderWithIntl(<PostPeriodForm campaignId="c-123" currency="USD" />);
    expect(screen.queryByLabelText(/^Currency/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Spend (USD)")).toBeInTheDocument();
  });

  it("first period of a campaign without figures: currency is editable, defaults to INR and is sent upper-cased", async () => {
    renderWithIntl(<PostPeriodForm campaignId="c-new" currency="INR" currencyEditable />);

    const currency = screen.getByLabelText(/^Currency/);
    expect(currency).toHaveValue("INR");
    fireEvent.change(currency, { target: { value: "usd" } });
    expect(screen.getByLabelText("Spend (USD)")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Period start/), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText("Spend (USD)"), { target: { value: "10.25" } });
    fireEvent.change(screen.getByLabelText("Revenue (USD)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Post period" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody()).toMatchObject({ currency: "USD", costMinor: "1025", revenueMinor: "0" });
  });

  it("rejects a malformed currency code client-side", async () => {
    renderWithIntl(<PostPeriodForm campaignId="c-new" currency="INR" currencyEditable />);

    fireEvent.change(screen.getByLabelText(/^Currency/), { target: { value: "U1" } });
    fireEvent.change(screen.getByLabelText(/^Period start/), { target: { value: "2026-08-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Post period" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/three-letter currency code/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
