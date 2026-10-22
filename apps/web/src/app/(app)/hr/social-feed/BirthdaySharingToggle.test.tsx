import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { BirthdaySharingToggle } from "./BirthdaySharingToggle";

function renderToggle(initialShare: boolean) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <BirthdaySharingToggle initialShare={initialShare} />
    </NextIntlClientProvider>,
  );
}

describe("BirthdaySharingToggle (GAP-HR-SOCIAL-FEED-01)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("is off when the employee has not opted in, and explains what turning it on shares", () => {
    renderToggle(false);
    expect(screen.getByRole("checkbox", { name: "Show my birthday on the social feed" })).not.toBeChecked();
    expect(screen.getByText(/Your date of birth and age are never shown/)).toBeInTheDocument();
  });

  it("reflects an existing opt-in", () => {
    renderToggle(true);
    expect(screen.getByRole("checkbox", { name: "Show my birthday on the social feed" })).toBeChecked();
  });

  it("turning it on PUTs {share:true} -- and nothing else, no employee id -- then confirms", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "pending" }), { status: 202 }));
    renderToggle(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Show my birthday on the social feed" }));
    expect(await screen.findByText("Saved. Your birthday will be shown on the feed.")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/proxy/v1/hrms/me/birthday-sharing");
    expect((init as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ share: true });
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("turning it off PUTs {share:false}", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    renderToggle(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(await screen.findByText("Saved. Your birthday will not be shown.")).toBeInTheDocument();
    expect(JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body))).toEqual({ share: false });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("on a failed save it keeps the old value and shows a plain-language alert, never raw server text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Internal Server Error at /srv/app/social.js:42 ECONNREFUSED", { status: 500 }));
    renderToggle(false);
    fireEvent.click(screen.getByRole("checkbox"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/ECONNREFUSED|social\.js|Internal Server Error|500/);
    expect((alert.textContent ?? "").trim().length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeChecked());
    expect(screen.queryByText(/Saved\./)).not.toBeInTheDocument();
  });
});
