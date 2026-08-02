/**
 * segments/commands.ts — publishes segment mutation commands to the queue.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function createSegment(
  ctx: RequestContext,
  body: { name: string; description: string | null; segmentType: string; criteria: Record<string, unknown> },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createSegment, id, { id, ...body });
}

export async function updateSegment(
  ctx: RequestContext,
  id: string,
  body: { version: number; patch: Record<string, unknown> },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.updateSegment, id, { id, version: body.version, patch: body.patch });
}

export async function deleteSegment(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.deleteSegment, id, { id, version });
}
