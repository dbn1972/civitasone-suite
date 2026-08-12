import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateApplicationInput {
  organiserName: string;
  organiserOrg?: string | undefined;
  organiserPhone: string;
  eventType: string;
  venueName: string;
  venueAddress: { line1: string; line2?: string | undefined; city: string; pin: string; ward?: string | undefined; zone?: string | undefined };
  startDate: string;
  endDate: string;
  expectedAttendance: number;
  temporaryStructures?: Array<{ type: string; count: number; areaSqft?: number | undefined }> | undefined;
  soundPermission?: boolean | undefined;
  documents?: Array<{ docType: string; fileId: string; uploadedAt: string }> | undefined;
}

export async function createApplication(ctx: RequestContext, body: CreateApplicationInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createApplication, id, { id, ...body });
}

export async function submitApplication(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.submitApplication, id, { id });
}

export async function withdrawApplication(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.withdrawApplication, id, { id });
}
