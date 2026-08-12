import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function reviewRequest(ctx: RequestContext, requestId: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.reviewRequest, requestId, { requestId });
}

export async function approveRequest(
  ctx: RequestContext,
  requestId: string,
  level: number,
  remarks?: string,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.approveRequest, id, {
    id,
    requestId,
    level,
    remarks,
  });
}

export async function rejectRequest(
  ctx: RequestContext,
  requestId: string,
  level: number,
  remarks: string,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.rejectRequest, id, {
    id,
    requestId,
    level,
    remarks,
  });
}

export async function returnRequest(
  ctx: RequestContext,
  requestId: string,
  level: number,
  remarks: string,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.returnRequest, id, {
    id,
    requestId,
    level,
    remarks,
  });
}
