/**
 * steps/commands.ts — publishes step-execution commands to the queue.
 * No DB access here; the consumer applies the write and performs the dispatch.
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
  /**
   * The step definition's config, resolved from the journey by the route. The
   * consumer dispatches on this, so a caller cannot smuggle in a config the
   * journey definition does not contain.
   */
  stepConfig: Record<string, unknown>;
  /** Journey step count, so the consumer can advance the run without a cross-module read. */
  totalSteps: number;
  /** Attributes a `condition_check` step evaluates against. */
  context?: Record<string, unknown>;
}

export async function executeStep(ctx: RequestContext, body: ExecuteStepInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.stepExecute, id, { id, ...body });
}
