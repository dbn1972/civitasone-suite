import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateRegistrationInput {
  vendorName: string;
  vendorAadhaar: string;
  vendorPhone: string;
  vendorPhoto?: string | undefined;
  category: string;
  preferredZone?: string | undefined;
  documents?: Array<{ docType: string; fileId: string; uploadedAt: string }> | undefined;
}

export async function createRegistration(ctx: RequestContext, body: CreateRegistrationInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createRegistration, id, { id, ...body });
}

export async function submitRegistration(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.submitRegistration, id, { id });
}

export async function withdrawRegistration(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.withdrawRegistration, id, { id });
}
