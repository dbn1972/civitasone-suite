import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { NotificationExperiment } from "@civitasone/types";

// The page is an async Server Component that reads getNotificationExperiments();
// mock the loader so we can drive the {data, source} shape directly.
const getNotificationExperiments = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getNotificationExperiments: () => getNotificationExperiments(),
}));

import ExperimentsPage from "./page";

async function renderPage() {
  // Server Component returns a promise of JSX.
  render(await ExperimentsPage());
}

describe("GAP-NOTIFICATIONS-EXPERIMENTS-02 — a failed fetch is not an empty program", () => {
  beforeEach(() => {
    getNotificationExperiments.mockReset();
  });

  it("on fetch error shows a retry error state, '—' stats, and NOT the create-hint empty state", async () => {
    getNotificationExperiments.mockResolvedValue({ data: [], source: "error" });
    await renderPage();

    // No create-hint that would invite a duplicate experiment.
    expect(screen.queryByText(/Create an A\/B or multivariate experiment/i)).not.toBeInTheDocument();
    // Stats read as unknown, not a fabricated zero.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // An error/retry affordance is visible.
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("on a genuinely empty API result shows the create-hint empty state", async () => {
    getNotificationExperiments.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText(/Create an A\/B or multivariate experiment/i)).toBeInTheDocument();
  });

  it("renders winner name + margin and a distinct status label for a concluded winner (03/04)", async () => {
    const rows: NotificationExperiment[] = [
      {
        id: "e1", name: "Subject-line test", status: "concluded",
        winnerVariantId: "11111111-2222-3333-4444-555555555555",
        winnerVariantKey: "B", winnerMarginPct: 7, concludedAt: null,
      },
    ];
    getNotificationExperiments.mockResolvedValue({ data: rows, source: "api" });
    await renderPage();
    expect(screen.getByText(/Variant B \(\+7% click-rate margin\)/)).toBeInTheDocument();
    expect(screen.getByText("Concluded")).toBeInTheDocument();
  });
});
