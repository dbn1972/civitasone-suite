import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { RetentionPolicyView } from "./schema.js";
import type { CreateRetentionPolicyBody, UpdateRetentionPolicyBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

const RESOURCE = "retention-policy";

export async function retentionPolicyCreate(ctx: RequestContext, body: CreateRetentionPolicyBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: RetentionPolicyView = {
    id,
    tenantId: ctx.tenantId,
    name: body.name,
    categoryId: body.categoryId ?? null,
    retentionYears: body.retentionYears,
    retentionDays: body.retentionDays ?? 0,
    action: body.action,
    notifyBefore: body.notifyBefore ?? 90,
    reminderMonths: body.reminderMonths,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ctx.actorId,
    updatedBy: ctx.actorId,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.retentionPolicyCreate, {
    messageId: id,
    type: COMMANDS.retentionPolicyCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function retentionPolicyUpdate(ctx: RequestContext, id: string, body: UpdateRetentionPolicyBody): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.retentionPolicyUpdate, {
    messageId,
    type: COMMANDS.retentionPolicyUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, ...body },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function retentionPolicyApply(ctx: RequestContext, policyId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.retentionPolicyApply, {
    messageId: id,
    type: COMMANDS.retentionPolicyApply,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { policyId, tenantId: ctx.tenantId },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
