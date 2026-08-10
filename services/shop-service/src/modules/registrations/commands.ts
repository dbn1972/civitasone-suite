import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateApplicationInput {
  establishmentName: string;
  establishmentType: string;
  ownerName: string;
  ownerType: string;
  premisesAddress: {
    line1: string;
    line2?: string | undefined;
    city: string;
    pin: string;
    ward?: string | undefined;
    zone?: string | undefined;
  };
  premisesPropertyId?: string | undefined;
  activityDescription?: string | undefined;
  activityCategory: string;
  employeeCount?: number | undefined;
  capacityDetails?: { seating?: number | undefined; areaSqft?: number | undefined; floors?: number | undefined } | undefined;
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

export async function recordFeePayment(
  ctx: RequestContext,
  id: string,
  transactionId: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.recordFeePayment, id, { id, transactionId });
}
