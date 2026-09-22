import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { FeedbackWidget } from "./FeedbackWidget";

// usePathname is globally mocked to "/" in vitest.setup.ts, so the per-page
// storage key used below is always "civitasone.feedback./".
const GLOBAL_KEY = "civitasone.feedback.dismissedUntil";
const PAGE_KEY = "civitasone.feedback./";

describe("FeedbackWidget", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not appear immediately on page arrival (earned, not ambushed)", () => {
    render(<FeedbackWidget />);
    expect(screen.queryByText("Was this helpful?")).not.toBeInTheDocument();
  });

  it("appears once the earn delay elapses", () => {
    render(<FeedbackWidget />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("Was this helpful?")).toBeInTheDocument();
  });

  it("dismissing hides it and remembers app-wide, not just on the current page", () => {
    render(<FeedbackWidget />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss feedback prompt" }));

    expect(screen.queryByText("Was this helpful?")).not.toBeInTheDocument();
    expect(localStorage.getItem(GLOBAL_KEY)).toBeTruthy();
    // Confirms the fix: dismissal is a single global key, not one keyed by
    // pathname — otherwise closing it here would do nothing for the next
    // of the app's 70+ other routes.
    expect(localStorage.getItem(PAGE_KEY)).toBeNull();
  });

  it("a recent global dismissal keeps it hidden on a fresh mount (e.g. after navigating)", () => {
    localStorage.setItem(GLOBAL_KEY, String(Date.now()));
    render(<FeedbackWidget />);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.queryByText("Was this helpful?")).not.toBeInTheDocument();
  });

  it("an old (>24h) global dismissal no longer suppresses it", () => {
    const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem(GLOBAL_KEY, String(twentyFiveHoursAgo));
    render(<FeedbackWidget />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText("Was this helpful?")).toBeInTheDocument();
  });

  it("submitting a rating marks only the exact page it was given on", () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true } as Response);

    render(<FeedbackWidget />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Yes, this was helpful" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/proxy/v1/admin/feedback",
      expect.objectContaining({ method: "POST" }),
    );
    expect(localStorage.getItem(PAGE_KEY)).toBeTruthy();
    // A page-specific "thanks" shouldn't silence the whole app.
    expect(localStorage.getItem(GLOBAL_KEY)).toBeNull();
  });
});
