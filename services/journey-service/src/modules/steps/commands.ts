/**
 * steps/commands.ts — publishes step-execution commands to the queue.
 * No DB access here; the consumer applies the write.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface ExecuteStepInput {
  journeyId: string;
  profileId: string;
  stepIndex: number;
  stepType: string;
}

export async function executeStep(ctx: RequestContext, body: ExecuteStepInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.stepExecute, id, { id, ...body });
}
