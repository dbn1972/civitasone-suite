import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";
import type { CreateRuleBody, UpdateRuleBody } from "./validators.js";

const RESOURCE = "segment_eligibility_rule";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createRule(ctx: RequestContext, body: CreateRuleBody): Promise<Accepted> {
  const id = commandId(ctx, COMMANDS.createSegmentEligibilityRule);
  await queue.publish(COMMANDS.createSegmentEligibilityRule, {
    messageId: id,
    type: COMMANDS.createSegmentEligibilityRule,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateRule(ctx: RequestContext, id: string, body: UpdateRuleBody): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.updateSegmentEligibilityRule}:${id}`);
  await queue.publish(COMMANDS.updateSegmentEligibilityRule, {
    messageId: msgId,
    type: COMMANDS.updateSegmentEligibilityRule,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteRule(ctx: RequestContext, id: string): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.deleteSegmentEligibilityRule}:${id}`);
  await queue.publish(COMMANDS.deleteSegmentEligibilityRule, {
    messageId: msgId,
    type: COMMANDS.deleteSegmentEligibilityRule,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, RESOURCE, id));
  await cache.invalidateResource(ctx.tenantId, RESOURCE);
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
