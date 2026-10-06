import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CopilotTurn } from "@civitasone/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const getCopilotTurnsMock = vi.fn();
vi.mock("../../../_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("../../../_data/loaders")>("../../../_data/loaders");
  return { ...actual, getCopilotTurns: () => getCopilotTurnsMock() };
});

import CopilotPage from "./page";

function turn(over: Partial<CopilotTurn> = {}): CopilotTurn {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    userId: null,
    prompt: "Summarise the pending sanctions",
    response: "Three sanctions are pending approval.",
    sourceCitations: [],
    model: "gpt-4o",
    tokens: 120,
    latencyMs: 400,
    createdAt: "2026-08-01T10:00:00.000Z",
    version: 1,
    ...over,
  };
}

describe("CopilotPage (GAP-AI-COPILOT-01/03/04)", () => {
  beforeEach(() => getCopilotTurnsMock.mockReset());

  it("source 'error' -> retry state, stat values '—', no empty-table copy", async () => {
    getCopilotTurnsMock.mockResolvedValue({ data: { turns: [], total: null }, source: "error" });
    render(await CopilotPage());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("No copilot turns yet")).not.toBeInTheDocument();
    // the three count stat cards (plus latency) render "—" on error
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("source 'api' with [] still shows the empty state (not the retry state)", async () => {
    getCopilotTurnsMock.mockResolvedValue({ data: { turns: [], total: 0 }, source: "api" });
    render(await CopilotPage());
    expect(screen.getByText("No copilot turns yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("GAP-AI-COPILOT-04: shows the real server total and a 'latest 50' note at the cap", async () => {
    const turns = Array.from({ length: 50 }, (_, i) => turn({ id: `11111111-1111-1111-1111-0000000000${String(i).padStart(2, "0")}` }));
    getCopilotTurnsMock.mockResolvedValue({ data: { turns, total: 137 }, source: "api" });
    render(await CopilotPage());
    expect(screen.getByText("137")).toBeInTheDocument();
    expect(screen.getByText(/Showing the latest 50 turns of 137/)).toBeInTheDocument();
  });
});
