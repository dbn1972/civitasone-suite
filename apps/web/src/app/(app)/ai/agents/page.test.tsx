/**
 * GAP-AI-AGENTS-01 / -04 / -05 — the agents page shows a retry state on a fetch
 * error (not an empty "no agents" table), links to governance, and uses a
 * client-side back link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const getAiAgentRowsMock = vi.fn();
vi.mock("../_data", () => ({
  getAiAgentRows: (...a: unknown[]) => getAiAgentRowsMock(...a),
}));

import Page from "./page";

async function renderPage() {
  render((await Page()) as React.ReactElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  getAiAgentRowsMock.mockResolvedValue({
    data: [{ id: "3f2a9c1e-1111-4000-8000-000000000001", name: "Triage bot", status: "active", updatedAt: null }],
    source: "api",
  });
});

describe("agents page (GAP-AI-AGENTS-01/04/05)", () => {
  it("renders a retry state on error, not 'No agents defined'", async () => {
    getAiAgentRowsMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.queryByText("No agents defined")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry|refresh/i })).toBeInTheDocument();
  });

  it("links to governance (keyboard reachable) and back to the AI hub", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: "Manage in Governance" })).toHaveAttribute("href", "/ai/governance");
    expect(screen.getByRole("link", { name: "AI & Copilot" })).toHaveAttribute("href", "/ai");
  });

  it("renders the agent on success", async () => {
    await renderPage();
    expect(screen.getByText("Triage bot")).toBeInTheDocument();
  });
});
