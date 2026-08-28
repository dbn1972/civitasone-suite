import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface GenerateDemandInput {
  allotmentId: string;
  demandMonth: string;
  // string, not bigint: goes into a queue.publish() payload that gets
  // JSON.stringify'd on the real SQS/RabbitMQ drivers — a native bigint throws
  // there. String (not number) specifically because this value is now derived
  // from the allotment's own bigint monthlyRentMinor — a number could silently
  // lose precision for values beyond Number.MAX_SAFE_INTEGER; the consumer
  // parses back via BigInt(p.amountMinor) right before the Drizzle write.
  amountMinor: string;
  dueDate: string;
  lateFeeMinor?: string | undefined;
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
