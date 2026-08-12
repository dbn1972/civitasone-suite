import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateFieldActionInput {
  complaintId: string;
  actionType: string;
  drainAssetRef: string | null;
  notes: string | null;
  beforePhoto: string | null;
  afterPhoto: string | null;
  durationMinutes: number | null;
}

export async function createFieldAction(ctx: RequestContext, body: CreateFieldActionInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.fieldActionCreate, id, { id, performedBy: ctx.actorId, ...body });
}
