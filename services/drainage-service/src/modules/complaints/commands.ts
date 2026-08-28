import { randomUUID, randomInt } from "node:crypto";
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
  // Date.now() alone can collide under concurrent submissions landing in the
  // same millisecond (plausible for a citizen-facing complaint queue); a
  // random suffix is a mitigation, not a full fix — complaint_number now has a
  // real UNIQUE constraint (this is a brand-new table with no existing rows to
  // conflict with, so adding it now was zero-risk), matching how event-service
  // strengthens verification_code generation the same way.
  const complaintNumber = `DRN-${Date.now()}-${randomInt(1000, 9999)}`;
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
