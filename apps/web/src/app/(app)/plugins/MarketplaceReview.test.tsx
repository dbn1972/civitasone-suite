import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { MarketplaceReviewButton } from "./MarketplaceReview";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const withIntl = (ui: React.ReactElement, locale: "en" | "hi" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>{ui}</NextIntlClientProvider>
);

function openAndRate(rating: string) {
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  fireEvent.change(screen.getByRole("combobox"), { target: { value: rating } });
  return screen.getByRole("button", { name: "Submit review" });
}

describe("MarketplaceReviewButton: honest async state for plugin.marketplace.review", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("renders nothing for a non-manager", () => {
    const { container } = render(withIntl(<MarketplaceReviewButton listingId="m1" name="Billing" canManage={false} />));
    expect(container).toBeEmptyDOMElement();
  });

  it("refuses to submit without a rating and sends nothing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(withIntl(<MarketplaceReviewButton listingId="m1" name="Billing" canManage />));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit review" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Choose a rating from 1 to 5."));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts rating and comment, then says 'submitted, not saved yet' (never 'recorded') on 202", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: { reviewId: "r1" } }), { status: 202 }));
    render(withIntl(<MarketplaceReviewButton listingId="m1" name="Billing" canManage />));
    const submit = openAndRate("4");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Solid  " } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Review submitted.*not saved yet/));
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/proxy/v1/plugins/marketplace/m1/review",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ rating: 4, comment: "Solid" }) }),
    );
    expect(screen.queryByText("Review recorded")).not.toBeInTheDocument();
  });

  it("flips to 'recorded' only when the stored review carries the reviewId the POST returned", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let stored: { reviewId: string } | null = null;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
        if (init?.method === "POST") return new Response(JSON.stringify({ data: { reviewId: "r1" } }), { status: 202 });
        return new Response(JSON.stringify({ data: stored }), { status: 200 });
      });
      render(withIntl(<MarketplaceReviewButton listingId="m1" name="Billing" canManage />));
      fireEvent.click(openAndRate("5"));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Review submitted/));
      await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
      expect(screen.getByRole("status")).toHaveTextContent(/Review submitted/); // nothing stored yet
      stored = { reviewId: "OLD" };
      await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
      expect(screen.getByRole("status")).toHaveTextContent(/Review submitted/); // an older review is not ours
      stored = { reviewId: "r1" };
      await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Review recorded"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("after the poll cap it says still being recorded, not recorded", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
        init?.method === "POST" ? new Response(JSON.stringify({ data: { reviewId: "r1" } }), { status: 202 }) : new Response(JSON.stringify({ data: null }), { status: 200 }),
      );
      render(withIntl(<MarketplaceReviewButton listingId="m1" name="Billing" canManage />));
      fireEvent.click(openAndRate("3"));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Review submitted/));
      await act(async () => { await vi.advanceTimersByTimeAsync(3000 * 21); });
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Still being recorded/));
      expect(screen.queryByText("Review recorded")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed request shows an error in the dialog and claims nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403, headers: { "content-type": "application/json" } }));
    render(withIntl(<MarketplaceReviewButton listingId="m1" name="Billing" canManage />));
    fireEvent.click(openAndRate("2"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("a 202 with no reviewId cannot be confirmed, so it never claims recorded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(withIntl(<MarketplaceReviewButton listingId="m1" name="Billing" canManage />));
    fireEvent.click(openAndRate("5"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/Still being recorded/));
  });

  it("renders Hindi copy under the hi locale", () => {
    render(withIntl(<MarketplaceReviewButton listingId="m1" name="Billing" canManage />, "hi"));
    expect(screen.getByRole("button", { name: "समीक्षा करें" })).toBeInTheDocument();
  });

  it("en and hi define the same pluginMarketplaceReview keys", () => {
    const en = Object.keys((enMessages as unknown as Record<string, Record<string, string>>).pluginMarketplaceReview).sort();
    const hi = Object.keys((hiMessages as unknown as Record<string, Record<string, string>>).pluginMarketplaceReview).sort();
    expect(hi).toEqual(en);
  });
});
