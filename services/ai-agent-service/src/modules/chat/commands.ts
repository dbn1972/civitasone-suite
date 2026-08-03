import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function sendMessage(
  ctx: RequestContext,
  payload: {
    conversationId: string;
    messageId: string;
    isNew: boolean;
    channelId: string;
    profileId: string;
    language: string;
    sanitizedInput: string;
    tokens: number;
    violationCount: number;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.sendMessage, payload.messageId, payload);
}

export async function endConversation(
  ctx: RequestContext,
  conversationId: string,
  payload: { version: number; reason: string | null },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.endConversation, conversationId, {
    conversationId,
    version: payload.version,
    reason: payload.reason,
  });
}

export async function startChatSession(
  ctx: RequestContext,
  payload: { id: string; channelId: string; profileId: string; language: string },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.startChatSession, payload.id, payload);
}

export async function sendSessionMessage(
  ctx: RequestContext,
  payload: {
    conversationId: string;
    messageId: string;
    role: string;
    sanitizedInput: string;
    tokens: number;
    violationCount: number;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.sendMessage, payload.messageId, {
    ...payload,
    isNew: false,
    channelId: "",
    profileId: "",
    language: "en",
    sessionMessage: true,
  });
}

export async function recordBlockedAudit(
  ctx: RequestContext,
  payload: {
    action: string;
    input: string | null;
    reason: string;
    output?: string | null;
    extra?: Record<string, unknown>;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.recordBlockedAudit, id, {
    action: payload.action,
    input: payload.input,
    output: payload.output ?? null,
    blocked: true,
    reason: payload.reason,
    ...(payload.extra ?? {}),
  });
}
