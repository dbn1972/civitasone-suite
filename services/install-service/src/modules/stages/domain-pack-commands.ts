import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import {
  CITIZEN_PACK_DOMAIN_ACTIVATE,
  MUNICIPAL_ONBOARDING_PACK_KEYS,
} from "../orchestrator/domain-pack-constants.js";

export type DomainPackActivateAccepted = {
  id: string;
  status: string;
  correlationId: string;
  domainPackKey: string;
  stageNumber: number;
  packKeys: string[];
};

/**
 * FN-17 — Install Stage 3: publish Domain Pack activation to citizen-service.
 * Cross-service write via queue (no HTTP into another service's DB).
 */
export async function activateDomainPackStage3(
  ctx: RequestContext,
  body: { domainPackKey?: string; packKeys?: string[] },
): Promise<DomainPackActivateAccepted> {
  const domainPackKey = body.domainPackKey ?? "municipal-in-v1";
  const packKeys = body.packKeys?.length
    ? body.packKeys
    : [...MUNICIPAL_ONBOARDING_PACK_KEYS];
  const activationId = randomUUID();
  const stageId = randomUUID();

  const stageProjected = {
    id: stageId,
    tenantId: ctx.tenantId,
    name: "Activate Domain Pack",
    stepNumber: 3,
    description: `Activate ${domainPackKey} — import editable service drafts for local review.`,
    status: "active",
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, "stage", stageId), stageProjected);
  await cache.put(cache.makeKey(ctx.tenantId, "domain_pack_activation", activationId), {
    id: activationId,
    tenantId: ctx.tenantId,
    domainPackKey,
    packKeys,
    stageId,
    stageNumber: 3,
    status: "accepted",
  });

  // Track Stage 3 in install stages (CQRS create).
  await queue.publish(COMMANDS.createStage, {
    messageId: stageId,
    type: COMMANDS.createStage,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: stageProjected,
  });

  // Cross-service: citizen-service packs consumer imports drafts.
  await queue.publish(CITIZEN_PACK_DOMAIN_ACTIVATE, {
    messageId: activationId,
    type: CITIZEN_PACK_DOMAIN_ACTIVATE,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id: activationId,
      tenantId: ctx.tenantId,
      domainPackKey,
      packKeys,
      stageNumber: 3,
      source: "install_stage_3",
    },
  });

  return {
    id: activationId,
    status: "accepted",
    correlationId: ctx.correlationId,
    domainPackKey,
    stageNumber: 3,
    packKeys,
  };
}
