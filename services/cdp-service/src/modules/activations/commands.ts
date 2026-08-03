/**
 * activations/commands.ts — publishes segment-activation commands.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function activateSegment(
  ctx: RequestContext,
  body: {
    segmentId: string;
    channel: string;
    audienceCount: number;
    dispatchAt: string;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.activateSegment, id, { activationId: id, ...body });
}
