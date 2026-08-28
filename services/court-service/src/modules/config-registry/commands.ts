import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { deriveConfigId } from "./domain.js";
import { getConfigForPrecheck } from "./repo.js";
import { httpError } from "../../shared/context.js";
import {
  setConfigBody, type SetConfigBody,
  deactivateConfigBody, type DeactivateConfigBody,
} from "./validators.js";

export type SetConfigResult = { accepted: true; configId: string };
export type DeactivateConfigResult = { accepted: true; configId: string };

/**
 * Set (create or version-guarded update) a config entry (§47). The messageId/id
 * is deterministic per (tenant, namespace, key) so a redelivery of the SAME
 * (namespace, key) write is idempotent end-to-end.
 */
export async function setConfig(
  ctx: RequestContext, input: SetConfigBody,
): Promise<SetConfigResult> {
  const body = setConfigBody.parse(input);
  const configId = deriveConfigId(ctx.tenantId, body.namespace, body.configKey);

  // Synchronous pre-check -- ONLY when the caller supplied an expectedVersion
  // AND an entry already exists, exactly mirroring the consumer's own
  // conditional (config-registry/consumer.ts): absent expectedVersion is a
  // blind write, and no existing row means this is a first-write/create, so
  // neither case can ever be rejected by the consumer's version guard. Without
  // this precheck, a caller supplying a STALE expectedVersion against an
  // existing entry gets a fake 202 that dead-letters silently.
  if (body.expectedVersion !== undefined) {
    const current = await getConfigForPrecheck(ctx.tenantId, configId);
    if (current && current.version !== body.expectedVersion) {
      throw httpError(
        "CONFIG_VERSION_CONFLICT",
        `Expected version ${body.expectedVersion}, found ${current.version}`,
      );
    }
  }

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
 * Deactivate (soft-retire) a config entry (§47). messageId is idempotent per
 * (config + expectedVersion).
 */
export async function deactivateConfig(
  ctx: RequestContext, configId: string, input: DeactivateConfigBody,
): Promise<DeactivateConfigResult> {
  const body = deactivateConfigBody.parse(input);

  // Synchronous pre-check, in the SAME order as the consumer
  // (config-registry/consumer.ts): not-found is rejected; already-inactive is a
  // no-op the consumer accepts regardless of expectedVersion (checked BEFORE its
  // own version guard), so this precheck must skip the version check in that
  // case too, or it would reject a resubmit the consumer would have silently
  // accepted -- a stricter precheck than the authoritative consumer, a new
  // divergence, not just a fix. Only an ACTIVE entry with a stale expectedVersion
  // is a real conflict.
  const current = await getConfigForPrecheck(ctx.tenantId, configId);
  if (!current) throw httpError("CONFIG_NOT_FOUND", `Config entry not found: ${configId}`);
  if (current.active && current.version !== body.expectedVersion) {
    throw httpError(
      "CONFIG_VERSION_CONFLICT",
      `Expected version ${body.expectedVersion}, found ${current.version}`,
    );
  }

  const messageId = deterministicId(
    COURT_NAMESPACE,
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
