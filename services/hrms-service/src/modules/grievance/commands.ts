import { randomUUID } from "node:crypto";
import { idempotentId } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

type Accepted = { id: string; status: string; correlationId: string };

async function publish(topic: string, ctx: RequestContext, id: string, payload: Record<string, unknown>, messageId: string = randomUUID()): Promise<Accepted> {
  await queue.publish(topic, {
    messageId, type: topic,
    tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface RegisterGrievancePayload {
  employeeId: string;
  category: string;
  subject: string;
  description: string;
  filedDate: string;
}

/**
 * A client-supplied x-idempotency-key (the only header the BFF proxy and
 * gateway forward) makes a double-submitted registration collapse to ONE
 * grievance: the id and messageId are derived from it, so the second publish
 * is dropped by markProcessed / the primary key. Without a key each call is
 * a fresh grievance.
 */
export const registerGrievance = (ctx: RequestContext, p: RegisterGrievancePayload) => {
  const id = idempotentId(ctx);
  return publish(COMMANDS.grievanceRegister, ctx, id, { ...p }, id);
};

export const assignGrievance = (ctx: RequestContext, id: string, assigneeEmployeeId: string, note: string | null) =>
  publish(COMMANDS.grievanceAssign, ctx, id, { assigneeEmployeeId, note });

export const disposeGrievance = (ctx: RequestContext, id: string, disposition: string, remarks: string) =>
  publish(COMMANDS.grievanceDispose, ctx, id, { disposition, remarks });

/**
 * DPDP audit-on-read: opening a case detail (which carries the free-text
 * description) is itself an auditable access. Fire-and-forget, same async
 * shape as medicalClaimsListRead -- the route never writes to Postgres.
 */
export const recordGrievanceRead = (ctx: RequestContext, id: string) =>
  publish(COMMANDS.grievanceRead, ctx, id, {});
