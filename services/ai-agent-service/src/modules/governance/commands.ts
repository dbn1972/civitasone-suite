import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function scoreInteraction(
  ctx: RequestContext,
  payload: {
    id: string;
    conversationId: string;
    turnId: string;
    relevance: string;
    coherence: string;
    safety: string;
    overall: string;
    flagged: boolean;
    flagReason: string | null;
  },
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.scoreInteraction, payload.id, payload);
}
