import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function initiateScrutiny(ctx: RequestContext, applicationId: string, discipline: string, officerId: string): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.initiateScrutiny, id, { id, applicationId, discipline, officerId });
}

export async function completeScrutiny(ctx: RequestContext, id: string, findings: Record<string, unknown>, dcrResults?: Record<string, unknown>, deficiencyDetails?: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.completeScrutiny, id, { id, findings, dcrResults, deficiencyDetails });
}

export async function decideApplication(ctx: RequestContext, applicationId: string, decision: string, reason?: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.decideApplication, applicationId, { applicationId, decision, reason });
}
