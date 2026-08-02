/**
 * profiles/commands.ts — publishes profile mutation commands to the queue.
 * No DB access here; the consumer applies the write.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateProfileInput {
  profileType: string;
  attributes: Record<string, unknown>;
  sourceLineage: Array<{ source: string; sourceId: string; timestamp: string }>;
}

export async function createProfile(ctx: RequestContext, body: CreateProfileInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.profileCreate, id, { id, ...body });
}

export async function updateProfile(
  ctx: RequestContext,
  id: string,
  body: { version: number; patch: Record<string, unknown> },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.profileUpdate, id, { id, version: body.version, patch: body.patch });
}

export async function mergeProfiles(
  ctx: RequestContext,
  body: { winnerId: string; loserId: string },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.mergeProfiles, body.winnerId, { ...body });
}
