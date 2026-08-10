import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function issuePermit(
  ctx: RequestContext,
  applicationId: string,
  establishmentName: string,
  validityMonths?: number,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.issuePermit, id, {
    id,
    applicationId,
    establishmentName,
    validityMonths: validityMonths ?? 12,
  });
}

export async function suspendPermit(
  ctx: RequestContext,
  permitId: string,
  reason: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.suspendPermit, permitId, { permitId, reason });
}

export async function cancelPermit(
  ctx: RequestContext,
  permitId: string,
  reason: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.cancelPermit, permitId, { permitId, reason });
}

export async function restorePermit(
  ctx: RequestContext,
  permitId: string,
  reason: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.restorePermit, permitId, { permitId, reason });
}

export async function issueNotice(
  ctx: RequestContext,
  permitId: string,
  noticeDetails: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.issueNotice, id, { id, permitId, noticeDetails });
}
