import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const trackApplicationMock = vi.fn();
const fetchPublishedByKeyMock = vi.fn();

vi.mock("../_data/runtimeApi", async () => {
  const actual = await vi.importActual<typeof import("../_data/runtimeApi")>("../_data/runtimeApi");
  return {
    ...actual,
    trackApplication: (...a: unknown[]) => trackApplicationMock(...a),
    fetchPublishedByKey: (...a: unknown[]) => fetchPublishedByKeyMock(...a),
  };
});

import { TrackClient } from "./TrackClient";
import { TrackingError } from "../_data/runtimeApi";

function renderClient(locale: "en" | "hi" = "en") {
  const messages = locale === "hi" ? hiMessages : enMessages;
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <TrackClient serviceKey="trade-license" trackingNo="T-123" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  trackApplicationMock.mockReset();
  fetchPublishedByKeyMock.mockReset();
  fetchPublishedByKeyMock.mockResolvedValue(null);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("TrackClient (GAP-...-TRACK-01/03/04/06)", () => {
  it("TRACK-01: a 503 shows a retryable 'unavailable' state, NOT 'not found' wording", async () => {
    trackApplicationMock.mockRejectedValue(new TrackingError("unavailable", 503));
    renderClient();
    await waitFor(() =>
      expect(screen.getByText(enMessages.citizenServices.trackErrUnavailableTitle)).toBeInTheDocument(),
    );
    // no not-found wording leaked
    expect(screen.queryByText(enMessages.citizenServices.trackErrNotFoundTitle)).not.toBeInTheDocument();
    // retry success renders the timeline — click the Retry button (by role, not the body copy)
    trackApplicationMock.mockResolvedValue({
      trackingNo: "T-123",
      applicationId: "a1",
      status: "under-review",
      channel: "portal",
      acknowledgedAt: null,
    });
    fireEvent.click(screen.getByRole("button", { name: /retry|try again/i }));
    await waitFor(() => expect(screen.getByText("T-123")).toBeInTheDocument());
  });

  it("TRACK-01: a 404 shows not-found copy with no retry", async () => {
    trackApplicationMock.mockRejectedValue(new TrackingError("not_found", 404));
    renderClient();
    await waitFor(() =>
      expect(screen.getByText(enMessages.citizenServices.trackErrNotFoundTitle)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /retry|try again/i })).not.toBeInTheDocument();
  });

  it("TRACK-06: error state renders in Hindi", async () => {
    trackApplicationMock.mockRejectedValue(new TrackingError("not_found", 404));
    renderClient("hi");
    await waitFor(() =>
      expect(screen.getByText(hiMessages.citizenServices.trackErrNotFoundTitle)).toBeInTheDocument(),
    );
  });

  it("TRACK-03: notifications card shows an honest static line, not a permanent 'will appear here' empty state", async () => {
    trackApplicationMock.mockResolvedValue({
      trackingNo: "T-123",
      applicationId: "a1",
      status: "under-review",
      channel: "portal",
      acknowledgedAt: null,
    });
    renderClient();
    await waitFor(() => expect(screen.getByText("T-123")).toBeInTheDocument());
    expect(screen.getByText(enMessages.citizenServices.trackNotificationsStatic, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(enMessages.citizenServices.noMessagesMessage)).not.toBeInTheDocument();
  });

  it("TRACK-04: a resolved status shows the closure card, not 'Not issued yet'", async () => {
    trackApplicationMock.mockResolvedValue({
      trackingNo: "T-123",
      applicationId: "a1",
      status: "resolved",
      channel: "portal",
      acknowledgedAt: null,
    });
    renderClient();
    await waitFor(() => expect(screen.getByText("T-123")).toBeInTheDocument());
    expect(screen.getByText(enMessages.citizenServices.closureNoteTitle)).toBeInTheDocument();
    expect(screen.queryByText(enMessages.citizenServices.notIssuedTitle)).not.toBeInTheDocument();
  });
});
