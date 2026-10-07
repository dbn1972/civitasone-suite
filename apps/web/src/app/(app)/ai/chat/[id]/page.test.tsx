/**
 * GAP-AI-CHAT-DETAIL-02 / -04 / -05 — tests for the chat conversation detail
 * page's role gate, outage-vs-not-found distinction, and PII masking of citizen
 * transcript text.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockRoles: string[] = ["ai_user"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
  hasAnyRole: (sessionRoles: string[], allowed: string[]) =>
    allowed.some((r: string) => sessionRoles.includes(r)),
  AI_CHAT_READ_ROLES: ["ai_user", "ai_admin", "super_admin"],
}));

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => { redirectMock(...a); throw new Error("NEXT_REDIRECT"); },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const getChatConversationMock = vi.fn();
const getChatTranscriptMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({
  getChatConversation: (...a: unknown[]) => getChatConversationMock(...a),
  getChatTranscript: (...a: unknown[]) => getChatTranscriptMock(...a),
}));

import Page from "./page";

const ID = "aaaaaaaa-1111-4000-8000-000000000001";

function conversation(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    channelId: "bbbbbbbb-1111-4000-8000-000000000001",
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

function message(over: Record<string, unknown> = {}) {
  return {
    id: "cccccccc-1111-4000-8000-000000000001",
    conversationId: ID,
    role: "user",
    content: "My water supply has been off for three days",
    tokens: 12,
    createdAt: "2026-08-01T10:00:00.000Z",
    ...over,
  };
}

async function renderPage() {
  const el = await Page({ params: { id: ID } });
  render(el as React.ReactElement);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRoles = ["ai_user"];
  getChatConversationMock.mockResolvedValue({ data: conversation(), source: "api" });
  getChatTranscriptMock.mockResolvedValue({ data: [message()], source: "api" });
});

// GAP-AI-CHAT-DETAIL-04: role gate
describe("role gate (GAP-AI-CHAT-DETAIL-04)", () => {
  it("redirects a viewer with no AI role to /ai", async () => {
    mockRoles = ["employee"];
    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirectMock).toHaveBeenCalledWith("/ai");
  });

  it("renders for ai_user", async () => {
    mockRoles = ["ai_user"];
    await renderPage();
    expect(screen.getByText("Conversation")).toBeInTheDocument();
  });
});

// GAP-AI-CHAT-DETAIL-05: outage-vs-not-found
describe("outage vs not-found (GAP-AI-CHAT-DETAIL-05)", () => {
  it("service outage -> retry state (not 'Conversation not found')", async () => {
    getChatConversationMock.mockResolvedValue({ data: null, source: "error" });
    await renderPage();
    expect(screen.queryByText("Conversation not found")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry|refresh/i })).toBeInTheDocument();
  });

  it("404 (conversation does not exist) -> 'Conversation not found'", async () => {
    getChatConversationMock.mockResolvedValue({ data: null, source: "api" });
    await renderPage();
    expect(screen.getByText("Conversation not found")).toBeInTheDocument();
  });

  it("transcript error -> Messages/Tokens show '—', not 0", async () => {
    getChatTranscriptMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    // The "Messages" stat card should show "—" (the missing-data dash) instead
    // of "0" when the transcript itself errored.
    const values = screen.getAllByText("—");
    expect(values.length).toBeGreaterThanOrEqual(1);
    // And there should be no "0" in the stat area
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});

// GAP-AI-CHAT-DETAIL-02: PII masking
describe("PII masking in transcript (GAP-AI-CHAT-DETAIL-02)", () => {
  it("redacts an Aadhaar number in citizen message text", async () => {
    getChatTranscriptMock.mockResolvedValue({
      data: [message({ content: "my aadhaar is 1234 5678 9012" })],
      source: "api",
    });
    await renderPage();
    // The full Aadhaar must not be present; only the last 4 should be visible.
    expect(screen.queryByText(/1234 5678 9012/)).not.toBeInTheDocument();
    expect(screen.getByText(/9012/)).toBeInTheDocument();
  });

  it("redacts a PAN in citizen message text", async () => {
    getChatTranscriptMock.mockResolvedValue({
      data: [message({ content: "my PAN is ABCDE1234F" })],
      source: "api",
    });
    await renderPage();
    expect(screen.queryByText(/ABCDE1234F/)).not.toBeInTheDocument();
  });
});
