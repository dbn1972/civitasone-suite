import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface RequestTransferInput {
  allotmentId: string;
  transfereeName: string;
  transfereeAadhaar?: string | undefined;
  reason?: string | undefined;
}

export async function requestTransfer(ctx: RequestContext, body: RequestTransferInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.requestTransfer, id, { id, requestType: "transfer", ...body });
}

export async function requestCancellation(ctx: RequestContext, allotmentId: string, reason?: string): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.requestCancellation, id, { id, allotmentId, requestType: "cancellation", reason });
}

export async function initiateEviction(ctx: RequestContext, allotmentId: string, reason: string): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.initiateEviction, id, { id, allotmentId, requestType: "eviction", reason });
}

export async function approveRequest(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.approveRequest, id, { id });
}

export async function rejectRequest(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.rejectRequest, id, { id, reason });
}

export async function completeRequest(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.completeRequest, id, { id });
}
