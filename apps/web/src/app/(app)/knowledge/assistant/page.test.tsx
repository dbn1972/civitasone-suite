import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const mockMetrics = vi.fn();
vi.mock("../_data/loaders", () => ({
  getAssistantMetrics: (...a: unknown[]) => mockMetrics(...a),
}));

import Page from "./page";

describe("AssistantPage", () => {
  beforeEach(() => mockMetrics.mockReset());

  // GAP-KNOWLEDGE-ASSISTANT-02: on error, stat cards show "—" not 0.
  it("shows — in stat cards when source is error", async () => {
    mockMetrics.mockResolvedValue({
      data: { total: 0, answered: 0, escalated: 0, deflected: 0, deflectionRate: 0, escalationRate: 0 },
      source: "error",
    });
    render(await Page());
    // All stat cards should show "—" 
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(4);
    // The AssistantClient (ask card) should still be present
    expect(screen.getByText("Ask a question")).toBeInTheDocument();
  });

  it("shows metric values when healthy", async () => {
    mockMetrics.mockResolvedValue({
      data: { total: 120, answered: 100, escalated: 10, deflected: 90, deflectionRate: 75, escalationRate: 8 },
      source: "api",
    });
    render(await Page());
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });
});
