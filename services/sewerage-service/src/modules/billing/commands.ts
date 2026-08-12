import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function generateBill(ctx: RequestContext, connectionId: string, billingPeriod: string, amountMinor: number, dueDate: string): Promise<Accepted> {
  const id = randomUUID();
  const billNumber = `SEWB-${Date.now()}`;
  return publishCommand(ctx, COMMANDS.billGenerate, id, { id, billNumber, connectionId, billingPeriod, amountMinor, dueDate });
}

export async function payBill(ctx: RequestContext, id: string, paymentRef: string, version: number): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.billPay, id, { id, paymentRef, version });
}
