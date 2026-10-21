import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const browserFetch = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: (...args: unknown[]) => browserFetch(...args),
  errorMessageFromResponse: async () => "err",
}));

import { LogActivityButton } from "./LogActivityButton";

beforeEach(() => browserFetch.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("LogActivityButton contact-picker failures (GAP-CRM-ACTIVITIES-06)", () => {
  it("surfaces an error note and Retry when the contacts fetch fails", async () => {
    browserFetch.mockResolvedValue({ ok: false, status: 500 });
    renderWithIntl(<LogActivityButton />);
    fireEvent.click(screen.getByRole("button", { name: "+ Log Activity" }));
    await waitFor(() =>
      expect(screen.getByText(/Contacts could not be loaded/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("Retry re-fetches and populates options on success", async () => {
    browserFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    renderWithIntl(<LogActivityButton />);
    fireEvent.click(screen.getByRole("button", { name: "+ Log Activity" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument(),
    );
    browserFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: "c1", name: "Asha" }] }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Asha" })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Contacts could not be loaded/)).not.toBeInTheDocument();
  });

  it("does not show the error note when contacts load successfully", async () => {
    browserFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "c1", name: "Asha" }] }),
    });
    renderWithIntl(<LogActivityButton />);
    fireEvent.click(screen.getByRole("button", { name: "+ Log Activity" }));
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Asha" })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Contacts could not be loaded/)).not.toBeInTheDocument();
  });
});

describe("LogActivityButton save failures use the shared human error", () => {
  async function openAndSubmit() {
    browserFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) }); // contacts
    renderWithIntl(<LogActivityButton />);
    fireEvent.click(screen.getByRole("button", { name: "+ Log Activity" }));
    await waitFor(() => expect(screen.getByLabelText(/^Notes/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^Notes/), { target: { value: "Called the ward office" } });
  }

  it("never shows a raw network exception (Failed to fetch)", async () => {
    await openAndSubmit();
    browserFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(screen.getByRole("button", { name: "Save activity" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/failed to fetch/i);
    expect((alert.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  // GAP-CRM-ACTIVITIES-08: the screen is "Activities", so the failure reads
  // "your activity" (it used to say "your interaction").
  it("names the record an 'activity', not an 'interaction', when a save fails", async () => {
    await openAndSubmit();
    browserFetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: "INTERNAL", message: "boom" }), { status: 500 }));
    fireEvent.click(screen.getByRole("button", { name: "Save activity" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/activity/i);
    expect(alert.textContent ?? "").not.toMatch(/interaction/i);
  });

  it("shows the standard permission message for a 403 (no status code, no server text)", async () => {
    await openAndSubmit();
    browserFetch.mockResolvedValueOnce(new Response(JSON.stringify({ code: "FORBIDDEN", message: "requires one of: crm_user" }), { status: 403 }));
    fireEvent.click(screen.getByRole("button", { name: "Save activity" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/403|requires one of|crm_user/);
    expect((alert.textContent ?? "").trim().length).toBeGreaterThan(0);
  });
});

describe("LogActivityButton inline client validation (SF-14a)", () => {
  async function open() {
    browserFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) }); // contacts
    renderWithIntl(<LogActivityButton />);
    fireEvent.click(screen.getByRole("button", { name: "+ Log Activity" }));
    await waitFor(() => expect(screen.getByLabelText(/^Notes/)).toBeInTheDocument());
  }

  it("blocks an empty save with an inline aria-invalid error and no request, then fixes and resubmits", async () => {
    await open();
    const callsAfterOpen = browserFetch.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Save activity" }));

    expect(await screen.findByText("Enter the notes for this activity.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Notes/)).toHaveAttribute("aria-invalid", "true");
    expect(browserFetch).toHaveBeenCalledTimes(callsAfterOpen);

    browserFetch.mockResolvedValueOnce({ ok: true });
    fireEvent.change(screen.getByLabelText(/^Notes/), { target: { value: "Called the ward office" } });
    fireEvent.click(screen.getByRole("button", { name: "Save activity" }));

    await waitFor(() => expect(browserFetch).toHaveBeenCalledTimes(callsAfterOpen + 1));
    const [url, init] = browserFetch.mock.calls.at(-1)!;
    expect(url).toBe("v1/crm/activities");
    expect(JSON.parse((init as RequestInit).body as string).text).toBe("Called the ward office");
    await waitFor(() => expect(screen.queryByText("Enter the notes for this activity.")).not.toBeInTheDocument());
  });
});
