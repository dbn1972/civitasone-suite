import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateComplaintInput {
  location: Record<string, unknown> | null;
  complaintType: string;
  description: string | null;
  photo: string | null;
  severity: string;
}

export async function createComplaint(ctx: RequestContext, body: CreateComplaintInput): Promise<Accepted> {
  const id = randomUUID();
  const complaintNumber = `DRN-${Date.now()}`;
  return publishCommand(ctx, COMMANDS.complaintCreate, id, { id, complaintNumber, reportedBy: ctx.actorId, ...body });
}

export async function assignComplaint(ctx: RequestContext, id: string, assignedTo: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.complaintAssign, id, { id, assignedTo, version });
}

export async function resolveComplaint(ctx: RequestContext, id: string, resolution: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.complaintResolve, id, { id, resolution, version });
}

export async function closeComplaint(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.complaintClose, id, { id, version });
}
