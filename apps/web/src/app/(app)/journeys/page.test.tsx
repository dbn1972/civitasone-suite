import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./_data", () => ({ getJourneyCounts: vi.fn() }));

import Page from "./page";
import { getJourneyCounts } from "./_data";

const mocked = vi.mocked(getJourneyCounts);

beforeEach(() => mocked.mockReset());

describe("Journeys hub page", () => {
  // GAP-JOURNEYS-HOME-01: tile copy matches destination content.
  it("labels the Builder tile 'Journey Definitions' (not 'Design and activate')", async () => {
    mocked.mockResolvedValue({ defined: 3, running: 1 });
    render(await Page());
    expect(screen.getByText("Journey Definitions")).toBeInTheDocument();
    expect(screen.queryByText(/Design and activate/i)).not.toBeInTheDocument();
  });

  it("labels the Templates tile 'Triggers' and drops the 'drop-off analysis, and conversions' promise", async () => {
    mocked.mockResolvedValue({ defined: 3, running: 1 });
    render(await Page());
    expect(screen.getByText("Triggers")).toBeInTheDocument();
    expect(screen.queryByText(/drop-off analysis, and conversions/i)).not.toBeInTheDocument();
  });

  // GAP-JOURNEYS-HOME-02: counts shown; '—' (never 0) on failure.
  it("shows running + defined counts when the loader succeeds", async () => {
    mocked.mockResolvedValue({ defined: 3, running: 1 });
    render(await Page());
    expect(screen.getByText("Journeys defined")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Running executions")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows '—' (not 0) when the count fetch failed", async () => {
    mocked.mockResolvedValue({ defined: null, running: null });
    render(await Page());
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
