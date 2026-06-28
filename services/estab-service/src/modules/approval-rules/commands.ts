import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateApprovalRuleBody, UpdateApprovalRuleBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createApprovalRule(
  ctx: RequestContext,
  body: CreateApprovalRuleBody,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.approvalRuleCreate, {
    messageId: id,
    type: COMMANDS.approvalRuleCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateApprovalRule(
  ctx: RequestContext,
  id: string,
  body: UpdateApprovalRuleBody,
): Promise<Accepted> {
  await queue.publish(COMMANDS.approvalRuleUpdate, {
    messageId: randomUUID(),
    type: COMMANDS.approvalRuleUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, patch: body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
