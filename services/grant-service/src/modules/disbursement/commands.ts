import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateInstallmentsBody, DisburseBody, PfmsReconcileBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };
export type AcceptedMany = { id: string; ids: string[]; status: string; correlationId: string };

export async function createInstallments(ctx: RequestContext, applicationId: string, body: CreateInstallmentsBody): Promise<AcceptedMany> {
  const ids = body.installments.map(() => randomUUID());
  const batchId = randomUUID();
  await queue.publish(COMMANDS.installmentCreate, {
    messageId: batchId, type: COMMANDS.installmentCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      applicationId, tenantId: ctx.tenantId, currency: body.currency,
      installments: body.installments.map((inst, i) => ({ ...inst, id: ids[i] })),
    },
  });
  return { id: batchId, ids, status: "accepted", correlationId: ctx.correlationId };
}

export async function inititateDisbursement(ctx: RequestContext, installmentId: string, body: DisburseBody): Promise<Accepted> {
  const id = idempotentId(ctx); // EVT-4: double-submit dedupe on disbursement
  await queue.publish(COMMANDS.disbursementInitiate, {
    messageId: id, type: COMMANDS.disbursementInitiate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, installmentId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function reconcilePfms(ctx: RequestContext, body: PfmsReconcileBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.pfmsReconcile, {
    messageId: id, type: COMMANDS.pfmsReconcile,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, records: body.records },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
