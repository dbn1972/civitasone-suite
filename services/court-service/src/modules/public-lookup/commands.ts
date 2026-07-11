import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { cnrPrefix, deriveEstablishmentDirId, publicCaseUrl } from "./domain.js";
import { deriveConfigId } from "../config-registry/domain.js";
import { publishEstablishmentBody, type PublishEstablishmentBody } from "./validators.js";

export type PublishEstablishmentResult = { accepted: true; establishmentId: string; publicSlug: string; publicUrl: string };

/**
 * Publish (or re-publish) a public-directory establishment (AUTHENTICATED, admin).
 * Write-via-queue: the route enqueues COMMANDS.publishEstablishment; the consumer
 * inserts the directory row. Idempotent — the establishment id is deterministic on
 * (tenantId + establishmentCode), so a re-submit is a no-op.
 *
 * cnr_prefix defaults to the first 6 chars of the establishment code, uppercased,
 * when the caller does not supply one.
 */
export async function publishEstablishment(
  ctx: RequestContext,
  input: PublishEstablishmentBody,
): Promise<PublishEstablishmentResult> {
  const body = publishEstablishmentBody.parse(input);
  const establishmentId = deriveEstablishmentDirId(ctx.tenantId, body.establishmentCode);
  const derivedPrefix = (body.cnrPrefix ?? cnrPrefix(body.establishmentCode)).toUpperCase();

  await queue.publish(COMMANDS.publishEstablishment, {
    messageId: establishmentId,
    type: COMMANDS.publishEstablishment,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id: establishmentId,
      tenantId: ctx.tenantId,
      establishmentCode: body.establishmentCode,
      cnrPrefix: derivedPrefix,
      courtName: body.courtName,
      publicSlug: body.publicSlug,
    },
  });

  // Optional turnkey onboarding: set the court's public-lookup access method in the
  // same call by fanning out a config.set for public_lookup/access_mode.
  if (body.accessMode) {
    const configId = deriveConfigId(ctx.tenantId, "public_lookup", "access_mode");
    await queue.publish(COMMANDS.setConfig, {
      messageId: configId,
      type: COMMANDS.setConfig,
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      correlationId: ctx.correlationId,
      schemaVersion: "1.0",
      payload: { namespace: "public_lookup", configKey: "access_mode", value: body.accessMode, id: configId, tenantId: ctx.tenantId },
    });
  }

  return { accepted: true, establishmentId, publicSlug: body.publicSlug, publicUrl: publicCaseUrl(body.publicSlug) };
}
