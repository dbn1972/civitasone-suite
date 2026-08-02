/**
 * tiers/commands.ts — publishes tier evaluation commands to the queue.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface EvaluateTierInput {
  enrolmentId: string;
  programId: string;
}

export async function evaluateTier(ctx: RequestContext, body: EvaluateTierInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.evaluateTier, id, { id, ...body });
}
