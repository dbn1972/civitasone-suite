import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface ReportComplaintInput {
  location: { lat?: number; lng?: number; address?: string; ward?: string; landmark?: string };
  animalType: string;
  complaintType: string;
  description?: string | undefined;
  photo?: string | undefined;
  severity: string;
}

export async function reportComplaint(ctx: RequestContext, body: ReportComplaintInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.reportComplaint, id, { id, ...body });
}

export async function assignComplaint(
  ctx: RequestContext,
  id: string,
  assignedTo: string,
  assignedTeam: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.assignComplaint, id, { id, assignedTo, assignedTeam });
}

export async function dispatchTeam(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.dispatchTeam, id, { id });
}

export async function closeComplaint(
  ctx: RequestContext,
  id: string,
  resolution: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.closeComplaint, id, { id, resolution });
}
