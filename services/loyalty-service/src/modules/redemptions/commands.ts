/**
 * redemptions/commands.ts — publishes redemption mutation commands to the queue.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface RedeemPointsInput {
  enrolmentId: string;
  memberId: string;
  points: number;
  rewardType: string;
  enrolmentVersion: number;
  /** true: create a pending redemption (points held) that an admin later fulfils or rejects. */
  deferFulfilment?: boolean;
}

export async function redeemPoints(ctx: RequestContext, body: RedeemPointsInput): Promise<Accepted> {
  const id = randomUUID();
  const { deferFulfilment, ...rest } = body;
  return publishCommand(ctx, COMMANDS.redeemPoints, id, {
    id,
    ...rest,
    status: deferFulfilment ? "pending" : "fulfilled",
  });
}

export async function voidRedemption(
  ctx: RequestContext,
  id: string,
  body: { reason: string; version: number; enrolmentId: string | null; points: string },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.voidRedemption, id, { id, ...body });
}

export async function fulfilRedemption(
  ctx: RequestContext,
  id: string,
  body: { version: number },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.fulfilRedemption, id, { id, ...body });
}

export async function rejectRedemption(
  ctx: RequestContext,
  id: string,
  body: { reason: string; version: number },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.rejectRedemption, id, { id, ...body });
}
