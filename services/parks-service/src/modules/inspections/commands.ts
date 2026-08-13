import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateInspectionInput {
  complaintId: string | null;
  treeRequestId: string | null;
  scheduledDate: string | null;
}

export async function createInspection(ctx: RequestContext, body: CreateInspectionInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.inspectionCreate, id, { id, inspectorId: ctx.actorId, ...body });
}

export async function completeInspection(
  ctx: RequestContext,
  id: string,
  findings: Record<string, unknown>,
  photos: string[] | null,
  workOrderRequired: boolean,
  version: number,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.inspectionComplete, id, { id, findings, photos, workOrderRequired, version });
}
