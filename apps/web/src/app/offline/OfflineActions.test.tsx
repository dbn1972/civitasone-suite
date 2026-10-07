import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// GAP-OFFLINE-HOME-02: the queue count comes from the durable request outbox.
const pendingRequestCountMock = vi.fn();
vi.mock("@/lib/sync/requestQueue", () => ({
  pendingRequestCount: () => pendingRequestCountMock(),
}));

import { OfflineActions } from "./OfflineActions";

function renderActions() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OfflineActions />
    </NextIntlClientProvider>,
  );
}

describe("OfflineActions", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    pendingRequestCountMock.mockReset();
    // jsdom's location is not writable; replace with a spy-able stub.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign: vi.fn(), reload: vi.fn() },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    vi.useRealTimers();
  });

  // GAP-OFFLINE-HOME-01: a working "Try again" that reloads the navigation.
  it("renders a Try again button that reloads the page", async () => {
    pendingRequestCountMock.mockResolvedValue(0);
    renderActions();
    const btn = await screen.findByRole("button", { name: /try again/i });
    btn.click();
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  // GAP-OFFLINE-HOME-01: dashboard link kept as a secondary action.
  it("keeps a secondary dashboard link", async () => {
    pendingRequestCountMock.mockResolvedValue(0);
    renderActions();
    const link = await screen.findByRole("link", { name: /dashboard/i });
    expect(link).toHaveAttribute("href", "/dashboard");
  });

  // GAP-OFFLINE-HOME-02: show the real pending count, not an unverifiable claim.
  it("shows the real queued-change count (plural)", async () => {
    pendingRequestCountMock.mockResolvedValue(3);
    renderActions();
    await waitFor(() => expect(screen.getByTestId("offline-queue")).toHaveTextContent("3 changes are saved"));
  });

  it("shows the singular form for one queued change", async () => {
    pendingRequestCountMock.mockResolvedValue(1);
    renderActions();
    await waitFor(() => expect(screen.getByTestId("offline-queue")).toHaveTextContent("1 change is saved"));
  });

  it("says nothing is queued when the outbox is empty", async () => {
    pendingRequestCountMock.mockResolvedValue(0);
    renderActions();
    await waitFor(() => expect(screen.getByTestId("offline-queue")).toHaveTextContent("No changes are waiting"));
  });

  it("falls back to the neutral copy when the outbox is unreadable", async () => {
    pendingRequestCountMock.mockRejectedValue(new Error("no indexeddb"));
    renderActions();
    await waitFor(() => expect(screen.getByTestId("offline-queue")).toHaveTextContent("No changes are waiting"));
  });

  // GAP-OFFLINE-HOME-01 / -05: reconnect announces + navigates away.
  it("announces 'Back online' and navigates to the dashboard when connectivity returns", async () => {
    pendingRequestCountMock.mockResolvedValue(0);
    renderActions();
    // Let the initial pendingRequestCount state settle before using fake timers.
    await screen.findByRole("button", { name: /try again/i });
    await waitFor(() => expect(screen.getByTestId("offline-queue")).toHaveTextContent("No changes are waiting"));

    vi.useFakeTimers();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    // Live region announces immediately (before the redirect).
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/back online/i);
    expect(window.location.assign).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(window.location.assign).toHaveBeenCalledWith("/dashboard");
  });
});
