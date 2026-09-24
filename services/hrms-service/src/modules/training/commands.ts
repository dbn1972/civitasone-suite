import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as employeeRepo from "../employee/repo.js";
import type { CreateTrainingBody, CreateNominationBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createTraining(ctx: RequestContext, body: CreateTrainingBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.trainingCreate, {
    messageId: id, type: COMMANDS.trainingCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * FK existence check (audit: orphaned-record risk) -- neither this
 * command's queue payload nor the consumer that ultimately calls
 * repo.insertNomination (training/consumer.ts) validated that trainingId
 * / employeeId actually exist before writing hrms_nominations, so a typo'd
 * or stale id would silently create an orphaned nomination with no FK
 * enforcement to catch it (hrms_nominations has no DB-level FK constraint
 * either). Fail fast here, synchronously, before the command is even
 * queued, rather than let it land broken downstream.
 */
export async function createNomination(ctx: RequestContext, body: CreateNominationBody): Promise<Accepted> {
  const training = await repo.getTraining(ctx.tenantId, body.trainingId);
  if (!training) throw new HttpError(404, "NOT_FOUND", "training not found");
  const employee = await employeeRepo.findById(body.employeeId, ctx.tenantId);
  if (!employee) throw new HttpError(404, "NOT_FOUND", "employee not found");

  const id = randomUUID();
  await queue.publish(COMMANDS.nominationCreate, {
    messageId: id, type: COMMANDS.nominationCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function completeNomination(
  ctx: RequestContext,
  id: string,
  body: { completedDate: string; result: string; score?: number | null; certificateRef?: string | null; trainingTitle?: string | null },
): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.nominationComplete, {
    messageId, type: COMMANDS.nominationComplete,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
