/**
 * steward/commands.ts — publishes steward decision commands to the queue.
 */
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function decideMerge(
  ctx: RequestContext,
  body: { mergeRequestId: string; decision: "approve" | "reject"; reason?: string },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.decideMerge, body.mergeRequestId, { ...body });
}
