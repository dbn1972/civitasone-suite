import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function startRestoration(
  ctx: RequestContext,
  permitId: string,
  startDate: string,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.startRestoration, id, { id, permitId, startDate });
}

export async function completeRestoration(
  ctx: RequestContext,
  id: string,
  quality: string,
  endDate: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.completeRestoration, id, { id, quality, endDate });
}

export async function decideDepositRefund(
  ctx: RequestContext,
  id: string,
  decision: string,
  refundMinor?: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.decideDepositRefund, id, { id, decision, refundMinor });
}
