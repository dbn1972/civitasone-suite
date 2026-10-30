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
  /** Id of the install stage row that tracks this activation (poll GET /v1/install/stages/:id). */
  stageId: string;
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

  // UAT W8-C: the two install-side commands are independent of each other, so they are published
  // CONCURRENTLY. Each SQS publish first discovers the subscriber queues (ListQueues), which took 3-4.5 s
  // per call on the UAT LocalStack; three strictly sequential publishes pushed this route past the
  // gateway's 15 s upstream timeout (504) although every command had been sent. The citizen command is
  // still published only AFTER both have resolved, so the activation record always exists before
  // citizen-service can report an outcome against it (applyActivationOutcome rejects an unknown record).
  //
  // Owner decision #28: durable per-tenant activation record (accepted -> completed/failed). Own
  // messageId so the record command is idempotent independently of the stage create / citizen commands.
  const recordPublished = queue.publish(COMMANDS.recordDomainPackActivation, {
    messageId: randomUUID(),
    type: COMMANDS.recordDomainPackActivation,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: activationId, domainPackKey, packKeys, stageId },
  });

  // Track Stage 3 in install stages (CQRS create).
  const stagePublished = queue.publish(COMMANDS.createStage, {
    messageId: stageId,
    type: COMMANDS.createStage,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: stageProjected,
  });
  await Promise.all([recordPublished, stagePublished]);

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
      // Echoed back on citizen.pack.domain_activated so the outcome lands on this stage row.
      stageId,
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
    stageId,
  };
}
