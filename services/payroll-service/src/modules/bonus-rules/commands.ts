import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateBonusRuleBody } from "./api.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createBonusRule(ctx: RequestContext, body: CreateBonusRuleBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.bonusRuleCreate, {
    messageId: id, type: COMMANDS.bonusRuleCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
