import { describe, expect, it } from "vitest";
import type { ChatConversation, ChatMessage } from "@civitasone/types";
import {
  conversationDurationMinutes,
  inReadingOrder,
  roleLabel,
  summariseConversations,
  summariseTranscript,
} from "./chat";

function conversation(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    channelId: "22222222-2222-2222-2222-222222222222",
    profileId: null,
    status: "active",
    language: "en",
    startedAt: "2026-08-01T10:00:00.000Z",
    endedAt: null,
    version: 1,
    ...overrides,
  };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "aaaa",
    conversationId: "11111111-1111-1111-1111-111111111111",
    role: "user",
    content: "My water supply has been off for three days",
    tokens: 12,
    createdAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("summariseConversations", () => {
  it("counts active and ended conversations", () => {
    const summary = summariseConversations([
      conversation({ status: "active" }),
      conversation({ status: "ended", endedAt: "2026-08-01T10:05:00.000Z" }),
      conversation({ status: "ended", endedAt: "2026-08-01T10:09:00.000Z" }),
    ]);
    expect(summary).toEqual({ total: 3, active: 1, ended: 2 });
  });

  it("returns zeroes for an empty list", () => {
    expect(summariseConversations([])).toEqual({ total: 0, active: 0, ended: 0 });
  });
});

describe("conversationDurationMinutes", () => {
  it("returns the duration in whole minutes", () => {
    expect(conversationDurationMinutes(conversation({
      status: "ended",
      startedAt: "2026-08-01T10:00:00.000Z",
      endedAt: "2026-08-01T10:07:00.000Z",
    }))).toBe(7);
  });

  it("returns null for a conversation still in progress", () => {
    expect(conversationDurationMinutes(conversation({ endedAt: null }))).toBeNull();
  });

  it("returns null when the end precedes the start rather than a negative duration", () => {
    expect(conversationDurationMinutes(conversation({
      status: "ended",
      startedAt: "2026-08-01T10:10:00.000Z",
      endedAt: "2026-08-01T10:00:00.000Z",
    }))).toBeNull();
  });

  it("returns null for an unparseable timestamp", () => {
    expect(conversationDurationMinutes(conversation({
      status: "ended",
      endedAt: "not-a-date",
    }))).toBeNull();
  });
});

describe("summariseTranscript", () => {
  it("counts messages per role and sums tokens", () => {
    const stats = summariseTranscript([
      message({ id: "a", role: "user", tokens: 10 }),
      message({ id: "b", role: "assistant", tokens: 25 }),
      message({ id: "c", role: "system", tokens: 5 }),
    ]);
    expect(stats).toEqual({ messages: 3, userMessages: 1, assistantMessages: 1, totalTokens: 40 });
  });

  it("tolerates messages with no token count", () => {
    const stats = summariseTranscript([message({ tokens: null }), message({ id: "b", tokens: 7 })]);
    expect(stats.totalTokens).toBe(7);
  });

  it("returns zeroes for an empty transcript", () => {
    expect(summariseTranscript([])).toEqual({
      messages: 0,
      userMessages: 0,
      assistantMessages: 0,
      totalTokens: 0,
    });
  });
});

describe("inReadingOrder", () => {
  it("orders messages oldest first", () => {
    const ordered = inReadingOrder([
      message({ id: "c", createdAt: "2026-08-01T10:02:00.000Z" }),
      message({ id: "a", createdAt: "2026-08-01T10:00:00.000Z" }),
      message({ id: "b", createdAt: "2026-08-01T10:01:00.000Z" }),
    ]);
    expect(ordered.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks identical timestamps on id so a turn and its reply keep a stable order", () => {
    const ordered = inReadingOrder([
      message({ id: "b", createdAt: "2026-08-01T10:00:00.000Z" }),
      message({ id: "a", createdAt: "2026-08-01T10:00:00.000Z" }),
    ]);
    expect(ordered.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      message({ id: "b", createdAt: "2026-08-01T10:01:00.000Z" }),
      message({ id: "a", createdAt: "2026-08-01T10:00:00.000Z" }),
    ];
    inReadingOrder(input);
    expect(input.map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("roleLabel", () => {
  it("maps known roles to readable labels", () => {
    expect(roleLabel("user")).toBe("Citizen");
    expect(roleLabel("assistant")).toBe("Assistant");
    expect(roleLabel("system")).toBe("System");
  });

  it("falls back to the raw role it does not know", () => {
    expect(roleLabel("tool")).toBe("tool");
  });
});
