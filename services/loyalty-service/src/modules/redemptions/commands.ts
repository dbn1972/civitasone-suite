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
}

export async function redeemPoints(ctx: RequestContext, body: RedeemPointsInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.redeemPoints, id, { id, ...body, status: "fulfilled" });
}

export async function voidRedemption(
  ctx: RequestContext,
  id: string,
  body: { reason: string; version: number; enrolmentId: string | null; points: string },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.voidRedemption, id, { id, ...body });
}
