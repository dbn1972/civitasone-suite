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
  severity: string | null;
}

export async function createComplaint(ctx: RequestContext, body: CreateComplaintInput): Promise<Accepted> {
  const id = randomUUID();
  // complaintNumber is no longer generated here: it used to be a bare
  // `SEWC-${Date.now()}` computed synchronously in this command handler,
  // which could collide under concurrent load. It is now reserved from a
  // real Postgres sequence inside the consumer's own transaction (see
  // repo.ts's nextComplaintNumber) — see migrations/0003_number_sequences.sql.
  return publishCommand(ctx, COMMANDS.complaintCreate, id, { id, reportedBy: ctx.actorId, ...body });
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

export interface CreateFieldRecordInput {
  complaintId: string | null;
  bookingId: string | null;
  assetRef: string | null;
  manholeRef: string | null;
  workPerformed: string | null;
  beforePhoto: string | null;
  afterPhoto: string | null;
}

export async function createFieldRecord(ctx: RequestContext, body: CreateFieldRecordInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.fieldRecordCreate, id, { id, ...body });
}
