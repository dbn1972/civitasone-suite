import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export async function scheduleInspection(
  ctx: RequestContext,
  input: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.scheduleInspection, id, { id, ...input });
}

export async function completeInspection(
  ctx: RequestContext,
  inspectionId: string,
  input: Record<string, unknown>,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.completeInspection, inspectionId, {
    inspectionId,
    ...input,
  });
}

export async function recordFindings(
  ctx: RequestContext,
  inspectionId: string,
  input: Record<string, unknown>,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.recordFindings, inspectionId, {
    inspectionId,
    ...input,
  });
}
