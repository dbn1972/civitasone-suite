import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface RecordServiceInput {
  bookingId: string;
  facilityId: string;
  serviceDate: string;
  slotNumber?: string | undefined;
  serviceType: string;
  notes?: string | undefined;
  completionCertificateRef?: string | undefined;
}

export async function recordService(ctx: RequestContext, body: RecordServiceInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.recordService, id, { id, ...body });
}
