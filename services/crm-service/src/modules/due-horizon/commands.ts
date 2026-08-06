import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { commandId } from "../../shared/idempotency.js";
import { COMMANDS } from "../../topics.js";

const RESOURCE = "due_horizon_config";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createConfig(ctx: RequestContext, body: {
  name: string;
  horizons: number[];
  groupBy: string;
  consentRequired: boolean;
  active: boolean;
}): Promise<Accepted> {
  const id = commandId(ctx, COMMANDS.createDueHorizonConfig);
  await queue.publish(COMMANDS.createDueHorizonConfig, {
    messageId: id,
    type: COMMANDS.createDueHorizonConfig,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateConfig(ctx: RequestContext, id: string, body: {
  name?: string | undefined;
  horizons?: number[] | undefined;
  groupBy?: string | undefined;
  consentRequired?: boolean | undefined;
  active?: boolean | undefined;
  version: number;
}): Promise<Accepted> {
  const msgId = commandId(ctx, `${COMMANDS.updateDueHorizonConfig}:${id}`);
  await queue.publish(COMMANDS.updateDueHorizonConfig, {
    messageId: msgId,
    type: COMMANDS.updateDueHorizonConfig,
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

export async function triggerRun(ctx: RequestContext, configId: string): Promise<Accepted> {
  const id = commandId(ctx, `${COMMANDS.runDueHorizonSweep}:${configId}`);
  await queue.publish(COMMANDS.runDueHorizonSweep, {
    messageId: id,
    type: COMMANDS.runDueHorizonSweep,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, configId, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
