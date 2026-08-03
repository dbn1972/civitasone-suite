/**
 * journeys/commands.ts — publishes journey mutation commands to the queue.
 * No DB access here; the consumer applies the write.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateJourneyInput {
  name: string;
  triggerConfig: Record<string, unknown> | null;
  steps: Array<Record<string, unknown>>;
}

export async function createJourney(ctx: RequestContext, body: CreateJourneyInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.journeyCreate, id, { id, ...body });
}

export async function updateJourney(
  ctx: RequestContext,
  id: string,
  body: { version: number; patch: Record<string, unknown> },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.journeyUpdate, id, { id, version: body.version, patch: body.patch });
}

export async function activateJourney(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.journeyActivate, id, { id, version });
}

export async function pauseJourney(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.journeyPause, id, { id, version });
}

export async function deleteJourney(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.journeyDelete, id, { id, version });
}
