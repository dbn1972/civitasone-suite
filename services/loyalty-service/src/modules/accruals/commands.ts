/**
 * accruals/commands.ts — publishes accrual mutation commands to the queue.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface AccruePointsInput {
  enrolmentId: string;
  points: number;
  source: string;
  sourceRef: string | null;
  txType: string;
  enrolmentVersion: number;
}

export async function accruePoints(ctx: RequestContext, body: AccruePointsInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.accruePoints, id, { id, ...body });
}
