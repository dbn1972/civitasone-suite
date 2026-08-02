import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function recordFeedback(
  ctx: RequestContext,
  body: {
    recommendationId: string;
    action: "accepted" | "rejected";
    reason: string | null;
    version: number;
    recordedAt: string;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.feedbackRecord, id, { id, ...body });
}
