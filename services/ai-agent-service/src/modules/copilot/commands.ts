import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function askCopilot(
  ctx: RequestContext,
  payload: {
    id: string;
    sanitizedInput: string;
    citations: Record<string, unknown>[];
    model: string | null;
    latencyMs: number;
    violationCount: number;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.askCopilot, payload.id, payload);
}

export async function summarize(
  ctx: RequestContext,
  payload: {
    id: string;
    sanitizedInput: string;
    model: string | null;
    maxLength: number | null;
    latencyMs: number;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.summarize, payload.id, payload);
}

export async function suggest(
  ctx: RequestContext,
  payload: { id: string; taskType: string; confidence: string },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.suggest, payload.id, payload);
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
