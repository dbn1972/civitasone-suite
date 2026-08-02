import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface UpsertRuleBody {
  priority: string;
  escalationHours: number;
  escalateTo: string;
  isActive: boolean;
}

export async function upsertRule(ctx: RequestContext, body: UpsertRuleBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.slaRuleUpsert, {
    messageId: id,
    type: COMMANDS.slaRuleUpsert,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      priority: body.priority,
      escalationHours: body.escalationHours,
      escalateTo: body.escalateTo,
      isActive: body.isActive,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
