import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export async function issueNoc(
  ctx: RequestContext,
  input: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.issueNoc, id, { id, ...input });
}

export async function suspendNoc(
  ctx: RequestContext,
  nocId: string,
  input: Record<string, unknown>,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.suspendNoc, nocId, { nocId, ...input });
}

export async function revokeNoc(
  ctx: RequestContext,
  nocId: string,
  input: Record<string, unknown>,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.revokeNoc, nocId, { nocId, ...input });
}
