/**
 * GAP-AI-CHAT-02 / -04 — ConversationsTable shows a short reference (not the raw
 * UUID), a routing queue and a waiting time for handed-off conversations, and
 * orders handed-off conversations first.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ChatConversation } from "@civitasone/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { ConversationsTable } from "./ConversationsTable";

const UUID_A = "abc12345-1111-4000-8000-000000000001"; // gitleaks:allow
const UUID_B = "def67890-2222-4000-8000-000000000002"; // gitleaks:allow

function conv(over: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: UUID_A,
    channelId: "11111111-1111-4000-8000-000000000001", // gitleaks:allow
    profileId: null,
    status: "active",
    language: "en",
    startedAt: "2026-08-01T10:00:00.000Z",
    endedAt: null,
    handedOffAt: null,
    handoffReason: null,
    handoffNote: null,
    handoffQueue: null,
    handoffContext: null,
    version: 1,
    ...over,
  };
}

describe("ConversationsTable (GAP-AI-CHAT-02/04)", () => {
  it("shows a short reference, never the full UUID, with the full id in the title", () => {
    render(<ConversationsTable conversations={[conv()]} />);
    expect(screen.queryByText(UUID_A)).not.toBeInTheDocument();
    const short = screen.getByText("abc12345");
    expect(short).toHaveAttribute("title", UUID_A);
  });

  it("shows the queue and a waiting time for a handed-off conversation", () => {
    render(
      <ConversationsTable
        conversations={[
          conv({
            status: "handed_off",
            handedOffAt: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
            handoffQueue: "water-supply-tier2",
          }),
        ]}
      />,
    );
    expect(screen.getByText("water-supply-tier2")).toBeInTheDocument();
    expect(screen.getByText(/Waiting 25m/)).toBeInTheDocument();
  });

  it("shows 'Unrouted' when a handed-off conversation has no queue", () => {
    render(
      <ConversationsTable
        conversations={[conv({ status: "handed_off", handedOffAt: "2026-08-01T10:01:00.000Z" })]}
      />,
    );
    expect(screen.getByText("Unrouted")).toBeInTheDocument();
  });

  it("orders handed-off conversations before active and ended", () => {
    render(
      <ConversationsTable
        conversations={[
          conv({ id: UUID_A, status: "active" }),
          conv({ id: UUID_B, status: "handed_off", handedOffAt: "2026-08-01T10:01:00.000Z" }),
        ]}
      />,
    );
    const handed = screen.getByText("def67890");
    const active = screen.getByText("abc12345");
    // handed-off (def) must appear before active (abc) in document order.
    expect(handed.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
