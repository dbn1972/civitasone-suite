import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { HealthFactors } from "./domain.js";

export type { Accepted };

export async function recomputeHealth(
  ctx: RequestContext,
  body: { accountId: string; score: number; factors: HealthFactors; computedAt: string },
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.healthRecompute, id, { id, ...body });
}
