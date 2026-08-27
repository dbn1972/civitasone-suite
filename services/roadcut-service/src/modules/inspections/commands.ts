import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function scheduleInspection(
  ctx: RequestContext,
  permitId: string,
  inspectionType: string,
  inspectorId: string,
  scheduledDate: string,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.scheduleInspection, id, {
    id,
    permitId,
    inspectionType,
    inspectorId,
    scheduledDate,
  });
}

export async function completeInspection(
  ctx: RequestContext,
  id: string,
  status: string,
  findings: Record<string, unknown>,
  photos?: Array<{ fileId: string; caption?: string | undefined }>,
  restorationQuality?: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.completeInspection, id, {
    id,
    status,
    findings,
    photos,
    restorationQuality,
  });
}
