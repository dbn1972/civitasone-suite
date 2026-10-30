import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { InsuranceUpsertPayload } from "./insurance.js";

export type Accepted = { id: string; status: "accepted"; correlationId: string };

/**
 * HR upserts an employee's medical insurance. The payload already carries the
 * card number / scheme id ENCRYPTED (insurance.ts buildUpsertPayload) -- the
 * row is written by insurance-consumer.ts.
 */
export async function upsertMedicalInsurance(ctx: RequestContext, payload: InsuranceUpsertPayload): Promise<Accepted> {
  await queue.publish(COMMANDS.medicalInsuranceUpsert, {
    messageId: randomUUID(), type: COMMANDS.medicalInsuranceUpsert, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload,
  });
  return { id: payload.id, status: "accepted", correlationId: ctx.correlationId };
}

/** HR removes an employee's current medical insurance record. */
export async function deleteMedicalInsurance(
  ctx: RequestContext, recordId: string, employeeId: string,
): Promise<Accepted> {
  await queue.publish(COMMANDS.medicalInsuranceDelete, {
    messageId: randomUUID(), type: COMMANDS.medicalInsuranceDelete, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: recordId, tenantId: ctx.tenantId, employeeId },
  });
  return { id: recordId, status: "accepted", correlationId: ctx.correlationId };
}
