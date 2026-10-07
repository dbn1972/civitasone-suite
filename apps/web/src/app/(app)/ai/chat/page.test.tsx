/**
 * GAP-AI-CHAT-01 / -03 — the chat list page shows a retry state (not "no
 * conversations yet") on a fetch error, and stat cards read accurate
 * server-side counts rather than the fetched page length.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const getChatConversationsMock = vi.fn();
const getChatConversationCountsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getChatConversations: (...a: unknown[]) => getChatConversationsMock(...a),
  getChatConversationCounts: (...a: unknown[]) => getChatConversationCountsMock(...a),
}));

import Page from "./page";

async function renderPage() {
  const el = await Page({ searchParams: {} });
  render(el as React.ReactElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  getChatConversationsMock.mockResolvedValue({ data: [], source: "api" });
  getChatConversationCountsMock.mockResolvedValue({
    data: { total: 150, active: 40, handedOff: 10, ended: 100 },
    source: "api",
  });
});

describe("chat list page (GAP-AI-CHAT-01/03)", () => {
  it("shows accurate counts from meta.total, not the fetched page length", async () => {
    // Only 2 rows fetched, but the counts say 150 total.
    getChatConversationsMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
  });

  it("shows a retry state (not 'No conversations yet') on a fetch error", async () => {
    getChatConversationsMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.queryByText("No conversations yet")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry|refresh/i })).toBeInTheDocument();
  });

  it("shows '—' for counts when the counts call failed, never a fabricated 0", async () => {
    getChatConversationCountsMock.mockResolvedValue({ data: null, source: "error" });
    await renderPage();
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("links to governance via a client-side next/link (no full reload)", async () => {
    await renderPage();
    const link = screen.getByRole("link", { name: "Governance" });
    expect(link).toHaveAttribute("href", "/ai/governance");
  });
});
