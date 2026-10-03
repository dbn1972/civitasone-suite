/**
 * fin-payroll-03 gap batch: command publishers. Routes call these after zod
 * validation + read-only guards and return 202; the idempotent consumers in
 * fin03-consumer.ts do the writes (transaction + audit outbox event).
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

function envelope(ctx: RequestContext, type: string, payload: Record<string, unknown>, messageId: string = randomUUID()) {
  return {
    messageId, type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...payload },
  };
}

/** GAP-PAYROLL-DDOS-03 */
export async function setDdoActive(ctx: RequestContext, ddoCode: string, active: boolean, reason: string): Promise<Accepted> {
  await queue.publish(COMMANDS.ddoSetActive, envelope(ctx, COMMANDS.ddoSetActive, { ddoCode, active, reason }));
  return { id: ddoCode, status: "accepted", correlationId: ctx.correlationId };
}

export type PayGroupFields = {
  name: string; frequency: string; payDayOfMonth: number; timezone: string;
  payWeekday: number | null; payLastDay: boolean; payWeekParity: number | null;
};

/** GAP-PAYROLL-PAY-GROUPS-03: the route sends the FULL merged field set. */
export async function updatePayGroup(ctx: RequestContext, id: string, fields: PayGroupFields): Promise<Accepted> {
  await queue.publish(COMMANDS.payGroupUpdate, envelope(ctx, COMMANDS.payGroupUpdate, { id, ...fields }));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function setPayGroupActive(ctx: RequestContext, id: string, active: boolean, reason: string): Promise<Accepted> {
  await queue.publish(COMMANDS.payGroupSetActive, envelope(ctx, COMMANDS.payGroupSetActive, { id, active, reason }));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** GAP-PAYROLL-PENSIONERS-03: `from` makes the consumer's UPDATE conditional. */
export async function setPensionerStatus(
  ctx: RequestContext, id: string,
  p: { from: string; to: "stopped" | "deceased"; reason: string; dateOfDeath: string | null },
): Promise<Accepted> {
  await queue.publish(COMMANDS.pensionerSetStatus, envelope(ctx, COMMANDS.pensionerSetStatus, { id, ...p }));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Read-side audit (PII reveal, pay-history read, receipt view). Awaited by
 * the caller BEFORE any sensitive value is returned, so a reveal that could
 * not be recorded is never served.
 */
export async function recordAudit(
  ctx: RequestContext,
  a: { action: string; resourceType: string; resourceId: string; details?: Record<string, unknown> },
): Promise<void> {
  await queue.publish(COMMANDS.auditRecord, envelope(ctx, COMMANDS.auditRecord, { ...a }));
}

/** GAP-PAYROLL-SALARY-REVISIONS-04 maker-checker decision. */
export async function decideSalaryRevision(
  ctx: RequestContext, id: string, decision: "approved" | "rejected", note: string | null,
): Promise<Accepted> {
  await queue.publish(COMMANDS.salaryRevisionDecide, envelope(ctx, COMMANDS.salaryRevisionDecide, { id, decision, note }));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
