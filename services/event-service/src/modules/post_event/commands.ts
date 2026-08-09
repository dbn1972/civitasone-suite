import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { publishCommand, type Accepted } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

export type { Accepted };

export async function conductInspection(
  ctx: RequestContext,
  permitId: string,
  findings: Record<string, unknown>,
  damageAssessment?: Record<string, unknown>,
): Promise<Accepted> {
  const id = randomUUID();
  return publishCommand(ctx, COMMANDS.conductInspection, id, {
    id,
    permitId,
    findings,
    damageAssessment,
  });
}

export async function decideDeposit(
  ctx: RequestContext,
  id: string,
  decision: string,
  refundMinor?: string,
): Promise<Accepted> {
  return publishCommand(ctx, COMMANDS.decideDeposit, id, { id, decision, refundMinor });
}
