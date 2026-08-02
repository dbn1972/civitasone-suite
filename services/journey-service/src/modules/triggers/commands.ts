/**
 * triggers/commands.ts — publishes trigger mutation commands to the queue.
 * No DB access here; the consumer applies the write.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateTriggerInput {
  journeyId: string;
  triggerType: string;
  config: Record<string, unknown>;
}

export async function createTrigger(ctx: RequestContext, body: CreateTriggerInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.triggerCreate, id, { id, ...body });
}

export async function updateTrigger(
  ctx: RequestContext,
  id: string,
  body: { version: number; patch: Record<string, unknown> },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.triggerUpdate, id, { id, version: body.version, patch: body.patch });
}

export async function deleteTrigger(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.triggerDelete, id, { id, version });
}
