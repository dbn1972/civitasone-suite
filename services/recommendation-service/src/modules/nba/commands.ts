/**
 * nba/commands.ts — publishes NBA mutation commands. No DB writes here.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function createRecommendation(
  ctx: RequestContext,
  body: {
    profileId: string;
    recommendationType: string;
    productId: string | null;
    channel: string | null;
    score: number;
    servedAt: string;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.nbaCreate, id, { id, ...body });
}

export async function acceptRecommendation(
  ctx: RequestContext,
  id: string,
  body: { version: number; feedbackId: string },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.nbaAccept, id, { id, ...body });
}

export async function rejectRecommendation(
  ctx: RequestContext,
  id: string,
  body: {
    version: number;
    feedbackId: string;
    reasonCode: string;
    reasonText: string | null;
    reason: string;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.nbaReject, id, { id, ...body });
}
