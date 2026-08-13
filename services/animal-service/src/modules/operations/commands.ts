import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface RecordOperationInput {
  complaintId: string;
  operationType: string;
  performedAt: string;
  animalTagId?: string | undefined;
  location?: { lat?: number; lng?: number; address?: string } | undefined;
  notes?: string | undefined;
  beforePhoto?: string | undefined;
  afterPhoto?: string | undefined;
  shelterRef?: string | undefined;
}

export async function recordOperation(ctx: RequestContext, body: RecordOperationInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.recordOperation, id, { id, ...body });
}
