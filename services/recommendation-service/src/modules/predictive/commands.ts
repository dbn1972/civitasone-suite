import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function upsertPredictiveScore(
  ctx: RequestContext,
  body: {
    subjectType: string;
    subjectId: string;
    modelType: string;
    score: string;
    confidence: string | null;
    modelVersion: string | null;
    features: Record<string, unknown>;
    computedAt: string;
  },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.predictiveUpsert, id, { id, ...body });
}
