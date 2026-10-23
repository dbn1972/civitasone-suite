import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { AppealPanel } from "./AppealPanel";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("applicationId=app-1") }));

function wrap(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("AppealPanel error rendering (CLOS-S1-05)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fill() {
    fireEvent.change(screen.getByLabelText("Decision date"), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText("Grounds for appeal"), { target: { value: "wrong decision" } });
    fireEvent.click(screen.getByRole("button", { name: "File appeal" }));
  }

  it("shows the translated fallback, not raw 'Failed to fetch', when filing fails offline", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch);
    wrap(<AppealPanel />);
    fill();
    expect(await screen.findByText(enMessages.citizenAppeals.errorGeneric)).toBeInTheDocument();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });

  it("keeps the specific window-expired message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: "FILING_WINDOW_EXPIRED" }), { status: 422, headers: { "content-type": "application/json" } })) as unknown as typeof fetch);
    wrap(<AppealPanel />);
    fill();
    expect(await screen.findByText(enMessages.citizenAppeals.errorWindowExpired)).toBeInTheDocument();
  });

  it("a 500 on the application search is an error state, not an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch);
    wrap(<AppealPanel />);
    const combo = screen.getAllByRole("combobox")[0];
    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: "a" } });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    // The picker's rejection handler renders an alert; an empty result renders "no results" instead.
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
