import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function createTriggerRule(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.triggerRuleCreate, id, { id, ...body });
}

export async function updateTriggerRule(
  ctx: RequestContext,
  id: string,
  body: { version: number; patch: Record<string, unknown> },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.triggerRuleUpdate, id, { id, ...body });
}

export async function deactivateTriggerRule(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.triggerRuleDeactivate, id, { id });
}
