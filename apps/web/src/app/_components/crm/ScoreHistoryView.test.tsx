import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ScoreHistoryView } from "./ScoreHistoryView";
import * as lq from "@/lib/crm/leadQualification";

vi.mock("@/lib/crm/leadQualification", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/leadQualification")>();
  return { ...actual, getScoreHistory: vi.fn() };
});

beforeEach(() => vi.mocked(lq.getScoreHistory).mockReset());

const entry: lq.ScoreHistoryEntry = {
  score: 80, previousScore: 60, factors: ["email opened", "site visit"], source: "engine", reason: "activity uptick", scoredAt: "2026-08-01",
};

describe("ScoreHistoryView (LQ-002)", () => {
  it("renders the timeline and current score from live data", async () => {
    vi.mocked(lq.getScoreHistory).mockResolvedValue({ data: [entry], source: "api" });
    render(<ScoreHistoryView leadId="l1" />);
    await waitFor(() => expect(screen.getByText(/activity uptick/i)).toBeInTheDocument());
    // "80" appears both in the current-score tile and the timeline entry.
    expect(screen.getAllByText("80").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Current score").nextElementSibling).toHaveTextContent("80");
    expect(screen.getByText("email opened")).toBeInTheDocument();
    expect(screen.queryByText(/showing saved information/i)).not.toBeInTheDocument();
  });

  it("gates the current score behind source==='error' (shows — + saved-info badge)", async () => {
    vi.mocked(lq.getScoreHistory).mockResolvedValue({ data: [], source: "error" });
    render(<ScoreHistoryView leadId="l1" />);
    await waitFor(() => expect(screen.getByText(/showing saved information/i)).toBeInTheDocument());
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(/score history unavailable/i)).toBeInTheDocument();
  });

  it("shows an empty (non-error) state with a dash when there are no changes yet", async () => {
    vi.mocked(lq.getScoreHistory).mockResolvedValue({ data: [], source: "api" });
    render(<ScoreHistoryView leadId="l1" />);
    await waitFor(() => expect(screen.getByText(/no score changes yet/i)).toBeInTheDocument());
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/showing saved information/i)).not.toBeInTheDocument();
  });
});
