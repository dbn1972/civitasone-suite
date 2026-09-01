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
 * Set (create or version-guarded update) a config entry (§47). `id` is
 * deterministic per (tenant, namespace, key) -- stable across every write to
 * the same entry. `messageId` is a DIFFERENT, content-aware key (the written
 * fields + expectedVersion): if it were just `id`, markProcessed's dedup
 * (keyed purely on messageId, @civitasone/outbox) would silently drop EVERY
 * update after the very first write to that entry, no matter how different
 * its content or how correct its expectedVersion -- a byte-identical retry
 * still dedupes correctly (same content -> same messageId), but a genuine
 * value change gets its own messageId and is never swallowed.
 */
export async function setConfig(
  ctx: RequestContext, input: SetConfigBody,
): Promise<SetConfigResult> {
  const body = setConfigBody.parse(input);
  const configId = deriveConfigId(ctx.tenantId, body.namespace, body.configKey);
  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:config-set:${configId}:${JSON.stringify({
      value: body.value,
      label: body.label ?? null,
      description: body.description ?? null,
      sortOrder: body.sortOrder ?? null,
      effectiveFrom: body.effectiveFrom ?? null,
      effectiveTo: body.effectiveTo ?? null,
      expectedVersion: body.expectedVersion ?? null,
    })}`,
  );

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
    messageId,
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
