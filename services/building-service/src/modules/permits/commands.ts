import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function issuePermit(ctx: RequestContext, applicationId: string, conditions?: Array<{ condition: string; category: string }>, validityMonths?: number): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.issuePermit, id, { id, applicationId, conditions, validityMonths: validityMonths ?? 24 });
}

export async function suspendPermit(ctx: RequestContext, permitId: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.suspendPermit, permitId, { permitId, reason });
}

export async function cancelPermit(ctx: RequestContext, permitId: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.cancelPermit, permitId, { permitId, reason });
}

export async function restorePermit(ctx: RequestContext, permitId: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.restorePermit, permitId, { permitId, reason });
}
