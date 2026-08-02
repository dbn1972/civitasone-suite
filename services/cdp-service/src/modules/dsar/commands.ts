/**
 * dsar/commands.ts — publishes DSAR raise/complete commands.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function raiseDsar(
  ctx: RequestContext,
  body: { profileId: string; requestType: string; reason: string | null },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.raiseDsar, id, { dsarId: id, ...body });
}

export async function completeDsar(
  ctx: RequestContext,
  id: string,
  body: { version: number; note?: string },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.completeDsar, id, { dsarId: id, ...body });
}
