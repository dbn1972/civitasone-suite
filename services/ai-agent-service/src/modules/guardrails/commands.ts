import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function checkGuardrails(
  ctx: RequestContext,
  payload: {
    sanitizedInput: string;
    passed: boolean;
    reason: string | null;
    agentId?: string;
    injectionDetected: boolean;
    injectionSeverity: string;
    injectionPatterns: string[];
    injectionBlocked: boolean;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.checkGuardrails, id, payload);
}

export async function checkInjection(
  ctx: RequestContext,
  payload: {
    agentId?: string;
    severity: string;
    patterns: string[];
    blocked: boolean;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.checkInjection, id, payload);
}

export async function createGuardrailRule(
  ctx: RequestContext,
  body: {
    name: string;
    ruleType: string;
    pattern: string | null;
    config: Record<string, unknown>;
    severity: string;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createGuardrailRule, id, { id, ...body });
}

export async function updateGuardrailRule(
  ctx: RequestContext,
  id: string,
  body: { version: number; patch: Record<string, unknown> },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.updateGuardrailRule, id, {
    id,
    version: body.version,
    patch: body.patch,
  });
}

export async function deleteGuardrailRule(
  ctx: RequestContext,
  id: string,
  version: number,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.deleteGuardrailRule, id, { id, version });
}
