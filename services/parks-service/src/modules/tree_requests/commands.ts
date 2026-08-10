import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface SubmitInput {
  requestType: string;
  location: Record<string, unknown> | null;
  treeSpecies: string | null;
  reason: string | null;
  photos: string[] | null;
}

export async function submitTreeRequest(ctx: RequestContext, body: SubmitInput): Promise<Accepted> {
  const id = randomUUID();
  const requestNumber = `PRKT-${Date.now()}`;
  return publishCommand(ctx, COMMANDS.treeRequestSubmit, id, { id, requestNumber, requestedBy: ctx.actorId, ...body });
}

export async function inspectTreeRequest(ctx: RequestContext, id: string, inspectionReport: Record<string, unknown>, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.treeRequestInspect, id, { id, inspectorId: ctx.actorId, inspectionReport, version });
}

export async function approveTreeRequest(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.treeRequestApprove, id, { id, approvedBy: ctx.actorId, version });
}

export async function rejectTreeRequest(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.treeRequestReject, id, { id, version });
}

export async function completeTreeRequest(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.treeRequestComplete, id, { id, version });
}
