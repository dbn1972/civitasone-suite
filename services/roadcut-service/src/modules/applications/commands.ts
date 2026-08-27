import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateApplicationInput {
  applicantName: string;
  applicantOrg?: string | undefined;
  purpose: string;
  location: { latitude: number; longitude: number; address: string; ward?: string | undefined; zone?: string | undefined };
  roadType: string;
  cuttingLength: string;
  cuttingWidth: string;
  cuttingDepth: string;
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

export async function startReview(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.startReview, id, { id });
}

export async function approveApplication(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.approveApplication, id, { id });
}

export async function rejectApplication(ctx: RequestContext, id: string, reason: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.rejectApplication, id, { id, reason });
}
