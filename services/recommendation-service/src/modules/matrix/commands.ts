/**
 * matrix/commands.ts — publishes matrix mutation commands. No DB writes here.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function createMatrixEntry(
  ctx: RequestContext,
  body: {
    triggerProductId: string;
    recommendedProductId: string;
    segment: string | null;
    channel: string | null;
    priority: number;
    weightBps: number;
    effectiveFrom: string | null;
    effectiveTo: string | null;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.matrixCreate, id, { id, ...body });
}

export async function updateMatrixEntry(
  ctx: RequestContext,
  id: string,
  body: { version: number; patch: Record<string, unknown> },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.matrixUpdate, id, { id, version: body.version, patch: body.patch });
}

export async function deleteMatrixEntry(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.matrixDelete, id, { id });
}
