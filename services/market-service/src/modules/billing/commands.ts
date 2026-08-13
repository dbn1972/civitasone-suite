import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface GenerateDemandInput {
  allotmentId: string;
  demandMonth: string;
  amountMinor: bigint;
  dueDate: string;
  lateFeeMinor?: bigint | undefined;
}

export async function generateDemand(ctx: RequestContext, body: GenerateDemandInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.generateDemand, id, { id, ...body } as Record<string, unknown>);
}

export async function recordPayment(ctx: RequestContext, id: string, paymentRef: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.recordPayment, id, { id, paymentRef });
}

export async function waiveDemand(ctx: RequestContext, id: string): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.waiveDemand, id, { id });
}
