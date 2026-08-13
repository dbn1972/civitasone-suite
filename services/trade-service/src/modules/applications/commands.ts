import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateApplicationInput {
  businessName: string;
  tradeCategory: string;
  subCategory?: string | undefined;
  ownerName: string;
  premisesAddress: {
    line1: string;
    line2?: string | undefined;
    city: string;
    pin: string;
    ward?: string | undefined;
    zone?: string | undefined;
  };
  areaInSqft?: number | undefined;
  employeeCount?: number | undefined;
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

export async function recordFeePayment(ctx: RequestContext, id: string, transactionId: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.recordFeePayment, id, { id, transactionId });
}
