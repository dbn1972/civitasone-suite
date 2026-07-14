import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, VISITOR_NAMESPACE, deriveConfigId } from "./domain.js";
import {
  setConfigBody, type SetConfigBody,
  deactivateConfigBody, type DeactivateConfigBody,
} from "./validators.js";

export type SetConfigResult = { accepted: true; configId: string };
export type DeactivateConfigResult = { accepted: true; configId: string };

/**
 * Set (create or version-guarded update) a config entry. The messageId/id is
 * deterministic per (tenant, namespace, key) so a redelivery of the SAME
 * (namespace, key) write is idempotent end-to-end.
 */
export async function setConfig(
  ctx: RequestContext, input: SetConfigBody,
): Promise<SetConfigResult> {
  const body = setConfigBody.parse(input);
  const configId = deriveConfigId(ctx.tenantId, body.namespace, body.configKey);

  await queue.publish(COMMANDS.setConfig, {
    messageId: configId,
    type: COMMANDS.setConfig,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: configId, tenantId: ctx.tenantId },
  });

  return { accepted: true, configId };
}

/**
 * Deactivate (soft-retire) a config entry. messageId is idempotent per
 * (config + expectedVersion).
 */
export async function deactivateConfig(
  ctx: RequestContext, configId: string, input: DeactivateConfigBody,
): Promise<DeactivateConfigResult> {
  const body = deactivateConfigBody.parse(input);
  const messageId = deterministicId(
    VISITOR_NAMESPACE,
    `${ctx.tenantId}:config-deactivate:${configId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.deactivateConfig, {
    messageId,
    type: COMMANDS.deactivateConfig,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { configId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, configId };
}
