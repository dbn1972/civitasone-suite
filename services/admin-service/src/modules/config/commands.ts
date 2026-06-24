import { idempotentId } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function toggleModule(ctx: RequestContext, tenantId: string, module: string, enabled: boolean): Promise<Accepted> {
  const id = idempotentId(ctx);
  await queue.publish(COMMANDS.moduleToggle, {
    messageId: id, type: COMMANDS.moduleToggle, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId, moduleKey: module, enabled },
  });
  await cache.invalidate(cache.makeKey(tenantId, "config", tenantId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createFeatureFlag(ctx: RequestContext, flagKey: string, enabled: boolean): Promise<Accepted> {
  const id = idempotentId(ctx);
  await queue.publish(COMMANDS.featureFlagCreate, {
    messageId: id, type: COMMANDS.featureFlagCreate, tenantId: "00000000-0000-0000-0000-000000000000",
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { flagKey, enabled },
  });
  await cache.invalidate("admin:platform:feature_flags");
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function overrideFeatureFlag(ctx: RequestContext, flagKey: string, tenantId: string, enabled: boolean): Promise<Accepted> {
  const id = idempotentId(ctx);
  await queue.publish(COMMANDS.featureFlagOverride, {
    messageId: id, type: COMMANDS.featureFlagOverride, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { flagKey, tenantId, enabled },
  });
  await cache.invalidate(cache.makeKey(tenantId, "config", tenantId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
