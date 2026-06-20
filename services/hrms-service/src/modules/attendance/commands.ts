import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { MarkAttendanceBody } from "./validators.js";

export type Accepted = { batchId: string; count: number; status: string; correlationId: string };

export async function markAttendance(ctx: RequestContext, body: MarkAttendanceBody): Promise<Accepted> {
  const batchId = randomUUID();
  await queue.publish(COMMANDS.attendanceMark, {
    messageId: batchId, type: COMMANDS.attendanceMark,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { batchId, tenantId: ctx.tenantId, records: body.records },
  });
  return { batchId, count: body.records.length, status: "accepted", correlationId: ctx.correlationId };
}
