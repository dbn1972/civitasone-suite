import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type CostingRuleUpdatePayload = { ruleId: string; splitPct?: number | undefined; status?: "active" | "inactive" | undefined };

export async function requestCostingRuleUpdate(
  ctx: RequestContext,
  payload: CostingRuleUpdatePayload,
): Promise<{ id: string; status: string; correlationId: string }> {
  const id = randomUUID();
  await queue.publish(COMMANDS.costingRuleUpdate, {
    messageId: id, type: COMMANDS.costingRuleUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
