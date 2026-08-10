import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface CreateRequestInput {
  applicantName: string;
  applicantPhone: string;
  originalServiceType: string;
  originalTransactionRef: string;
  originalAmountMinor: string;
  refundAmountMinor: string;
  refundReason: string;
  description?: string | undefined;
  documents?: Array<{ docType: string; fileId: string; uploadedAt: string }> | undefined;
}

export async function createRequest(ctx: RequestContext, body: CreateRequestInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.createRequest, id, { id, ...body });
}

export async function submitRequest(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.submitRequest, id, { id });
}

export async function withdrawRequest(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.withdrawRequest, id, { id });
}
