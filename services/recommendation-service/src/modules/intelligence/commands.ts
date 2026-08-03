import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";
import type { RiskSignal, WhiteSpaceEntry } from "./schema.js";

export type { Accepted };

export async function computeIntelligence(
  ctx: RequestContext,
  body: { accountId: string; whiteSpace: WhiteSpaceEntry[]; riskSignals: RiskSignal[] },
): Promise<Accepted> {
  const intelligenceId = randomUUID();
  return publishCommand(ctx, COMMANDS.intelligenceCompute, intelligenceId, {
    intelligenceId,
    ...body,
  });
}
