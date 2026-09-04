import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateComplaintInput {
  location: Record<string, unknown> | null;
  parkAssetRef: string | null;
  complaintType: string;
  description: string | null;
  photo: string | null;
  severity: string | null;
}

export async function createComplaint(ctx: RequestContext, body: CreateComplaintInput): Promise<Accepted> {
  const id = randomUUID();
  // complaintNumber is no longer generated here: it used to be a bare
  // `PRK-${Date.now()}` computed synchronously in this command handler,
  // which collided under concurrent load (two requests in the same
  // millisecond). It is now reserved from a real Postgres sequence inside
  // the consumer's own transaction (see repo.ts's nextComplaintNumber),
  // right before the insert — see migrations/0002_number_sequences.sql.
  return publishCommand(ctx, COMMANDS.CREATE_COMPLAINT, id, { id, reportedBy: ctx.actorId, ...body });
}

export async function assignComplaint(ctx: RequestContext, id: string, assignedTo: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.ASSIGN_COMPLAINT, id, { id, assignedTo, version });
}

export async function resolveComplaint(ctx: RequestContext, id: string, resolution: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.RESOLVE_COMPLAINT, id, { id, resolution, version });
}

export async function closeComplaint(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.CLOSE_COMPLAINT, id, { id, version });
}
