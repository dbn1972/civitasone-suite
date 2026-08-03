/**
 * executions/commands.ts — publishes execution-enrollment commands to the queue.
 * No DB access here; the consumer applies the write.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export interface EnrollExecutionInput {
  journeyId: string;
  profileId: string;
}

export async function enrollExecution(ctx: RequestContext, body: EnrollExecutionInput): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.executionEnroll, id, { id, ...body });
}
