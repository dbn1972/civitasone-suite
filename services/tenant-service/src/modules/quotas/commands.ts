/**
 * Quota command handlers (WRITE PATH).
 * Validate → publish command → return 202. Consumer does the durable DB write.
 * quotaCheck is synchronous (read-only) — not queued.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { QuotaSetBody, QuotaIncrementBody, QuotaCheckBody } from "./validators.js";
import * as repo from "./repo.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface QuotaCheckResult {
  allowed: boolean;
  resource: string;
  limit: number;
  used: number;
  usagePercent: number;
  overLimit: boolean;
}

const RESOURCE = "quota";

export async function quotaSet(ctx: RequestContext, body: QuotaSetBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.quotaSet, {
    messageId: id,
    type: COMMANDS.quotaSet,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: body.tenantId, resource: body.resource, limit: body.limit },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function quotaIncrement(ctx: RequestContext, body: QuotaIncrementBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.quotaIncrement, {
    messageId: id,
    type: COMMANDS.quotaIncrement,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { tenantId: body.tenantId, resource: body.resource, delta: body.delta },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * quotaCheck — synchronous read (not queued).
 * Returns whether the requested amount would exceed the quota.
 */
export async function quotaCheck(body: QuotaCheckBody): Promise<QuotaCheckResult> {
  const quota = await repo.findByTenantAndResource(body.tenantId, body.resource);
  if (!quota) {
    // No quota set = unlimited
    return { allowed: true, resource: body.resource, limit: 0, used: 0, usagePercent: 0, overLimit: false };
  }
  const wouldExceed = (quota.used + body.requestedAmount) > quota.limit;
  return {
    allowed: !wouldExceed,
    resource: body.resource,
    limit: quota.limit,
    used: quota.used,
    usagePercent: repo.usagePercent(quota),
    overLimit: repo.isOverLimit(quota),
  };
}
