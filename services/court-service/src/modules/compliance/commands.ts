import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { deriveDirectionId } from "./domain.js";
import {
  createDirectionBody, type CreateDirectionBody,
  updateComplianceBody, type UpdateComplianceBody,
} from "./validators.js";

export type CreateDirectionResult = { accepted: true; directionId: string };
export type UpdateComplianceResult = { accepted: true; directionId: string };

/** Create a compliance direction on a case (§26). Idempotent per
 *  (tenant + case + order + seq); `seq` defaults to 1 for the first direction. */
export async function createDirection(
  ctx: RequestContext, caseId: string, input: CreateDirectionBody,
): Promise<CreateDirectionResult> {
  const body = createDirectionBody.parse(input);
  const directionId = deriveDirectionId(ctx.tenantId, caseId, body.orderId, 1);

  await queue.publish(COMMANDS.createDirection, {
    messageId: directionId,
    type: COMMANDS.createDirection,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: directionId, caseId, tenantId: ctx.tenantId },
  });

  return { accepted: true, directionId };
}

/** Record progress / close a compliance direction (§26). messageId is idempotent
 *  per (direction + expectedVersion). */
export async function updateCompliance(
  ctx: RequestContext, directionId: string, input: UpdateComplianceBody,
): Promise<UpdateComplianceResult> {
  const body = updateComplianceBody.parse(input);
  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:compliance-update:${directionId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.updateCompliance, {
    messageId,
    type: COMMANDS.updateCompliance,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { directionId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, directionId };
}
