import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateAllowanceRulesBody } from "./rules-api.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** PAY-PROFILES: publish a new effective-dated tenant allowance-rule row (CQRS; consumer persists + audits). */
export async function createAllowanceRules(ctx: RequestContext, body: CreateAllowanceRulesBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.allowanceRulesCreate, {
    messageId: randomUUID(),
    type: COMMANDS.allowanceRulesCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
