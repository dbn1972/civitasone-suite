import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { MarkAttendanceBody, RegularisationCreateBody, PeriodLockBody } from "./validators.js";

export type Accepted = { id: string; batchId: string; count: number; status: string; correlationId: string };
export type AcceptedSingle = { id: string; status: string; correlationId: string };

export async function markAttendance(ctx: RequestContext, body: MarkAttendanceBody): Promise<Accepted> {
  const batchId = randomUUID();
  await queue.publish(COMMANDS.attendanceMark, {
    messageId: batchId, type: COMMANDS.attendanceMark,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { batchId, tenantId: ctx.tenantId, records: body.records },
  });
  return { id: batchId, batchId, count: body.records.length, status: "accepted", correlationId: ctx.correlationId };
}

export async function createRegularisation(ctx: RequestContext, body: RegularisationCreateBody): Promise<AcceptedSingle> {
  const id = randomUUID();
  await queue.publish(COMMANDS.regularisationCreate, {
    messageId: id, type: COMMANDS.regularisationCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id, tenantId: ctx.tenantId,
      employeeId: body.employeeId,
      date: body.date,
      requestedStatus: body.requestedStatus,
      reason: body.reason,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function decideRegularisation(
  ctx: RequestContext,
  reg: { id: string; employeeId: string; date: string; requestedStatus: string },
  decision: "approve" | "reject",
  reason?: string,
): Promise<AcceptedSingle> {
  await queue.publish(COMMANDS.regularisationDecide, {
    messageId: randomUUID(), type: COMMANDS.regularisationDecide,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id: reg.id, tenantId: ctx.tenantId, decision, reason: reason ?? null,
      employeeId: reg.employeeId, date: reg.date, requestedStatus: reg.requestedStatus,
    },
  });
  return { id: reg.id, status: "accepted", correlationId: ctx.correlationId };
}

async function publishLockState(
  ctx: RequestContext, topic: string, body: PeriodLockBody, status: "locked" | "open",
): Promise<AcceptedSingle> {
  const id = randomUUID();
  await queue.publish(topic, {
    messageId: id, type: topic,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, period: body.period, status, reason: body.reason ?? null },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export function lockPeriod(ctx: RequestContext, body: PeriodLockBody): Promise<AcceptedSingle> {
  return publishLockState(ctx, COMMANDS.attendanceLockPeriod, body, "locked");
}

export function unlockPeriod(ctx: RequestContext, body: PeriodLockBody): Promise<AcceptedSingle> {
  return publishLockState(ctx, COMMANDS.attendanceUnlockPeriod, body, "open");
}
