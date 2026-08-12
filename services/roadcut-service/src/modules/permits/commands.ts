import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function issuePermit(
  ctx: RequestContext,
  applicationId: string,
  workStartDate: string,
  workEndDate: string,
  conditions?: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.issuePermit, id, {
    id,
    applicationId,
    workStartDate,
    workEndDate,
    conditions,
  });
}

export async function extendPermit(ctx: RequestContext, id: string, extendedUntil: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.extendPermit, id, { id, extendedUntil });
}

export async function completePermit(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.completePermit, id, { id });
}

export async function cancelPermit(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.cancelPermit, id, { id, reason });
}
