import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export async function requestRenewal(
  ctx: RequestContext,
  input: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.requestRenewal, id, { id, ...input });
}

export async function decideRenewal(
  ctx: RequestContext,
  renewalId: string,
  input: Record<string, unknown>,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.decideRenewal, renewalId, { renewalId, ...input });
}
