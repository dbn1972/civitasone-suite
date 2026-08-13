import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function issueCertificate(ctx: RequestContext, permitId: string, certType: string, inspectionReport?: Record<string, unknown>): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.issueCertificate, id, { id, permitId, certType, inspectionReport });
}

export async function requestRenewal(ctx: RequestContext, permitId: string, renewalType: string, details?: Record<string, unknown>): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.requestRenewal, id, { id, permitId, renewalType, details });
}

export async function decideRenewal(ctx: RequestContext, id: string, decision: string, reason?: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.decideRenewal, id, { id, decision, reason });
}
