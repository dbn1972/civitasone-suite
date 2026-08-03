import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import {
  assertCorrectionApproverDistinct,
  assertCorrectionPending,
} from "./domain.js";
import * as repo from "./repo.js";

const log = pino({ name: "admin-f3-support" });
const AUDIT_TOPIC = "audit.event.record";

async function auditCorrection(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ctx: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  id: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "admin", action, resourceType: "data_correction", resourceId: id, outcome: "success" },
  });
}

export function registerF3_support_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    const op = String(p.op ?? "");
    if (!op.startsWith("support_op_")) return;
    const body = (p.body ?? {}) as Record<string, unknown>;
    const params = (p.params ?? {}) as Record<string, unknown>;
    const id = String(p.preId ?? params.id ?? p.id);
    const ctx = { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        if (op === "support_op_0") {
          await repo.insertCorrection(tx as repo.Writer, {
            id,
            tenantId: ctx.tenantId,
            targetTable: String(body.targetTable),
            targetId: String(body.targetId),
            justification: String(body.justification),
            proposedChange: body.proposedChange as Record<string, unknown>,
            ticketId: (body.ticketId as string | undefined) ?? null,
            status: "pending",
            proposedBy: ctx.actorId,
            createdBy: ctx.actorId,
            updatedBy: ctx.actorId,
          });
          await auditCorrection(tx, ctx, "data_correction.proposed", id);
        } else if (op === "support_op_1") {
          const row = await repo.findCorrectionByIdTx(tx as repo.Writer, id, ctx.tenantId);
          if (!row) throw new HttpError(404, "NOT_FOUND", "data correction not found");
          assertCorrectionPending(row.status);
          assertCorrectionApproverDistinct(row.proposedBy, ctx.actorId);
          await repo.updateCorrection(tx as repo.Writer, id, ctx.tenantId, {
            status: "approved", approvedBy: ctx.actorId, approvedAt: new Date(), updatedBy: ctx.actorId,
          });
          await enqueue(tx, {
            topic: "admin.data_correction.approved", eventType: "admin.data_correction.approved",
            tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
            payload: { id, targetTable: row.targetTable, targetId: row.targetId, proposedChange: row.proposedChange },
          });
          await auditCorrection(tx, ctx, "data_correction.approved", id);
        } else if (op === "support_op_2") {
          const row = await repo.findCorrectionByIdTx(tx as repo.Writer, id, ctx.tenantId);
          if (!row) throw new HttpError(404, "NOT_FOUND", "data correction not found");
          assertCorrectionPending(row.status);
          await repo.updateCorrection(tx as repo.Writer, id, ctx.tenantId, {
            status: "rejected", rejectedReason: String(body.reason), updatedBy: ctx.actorId,
          });
          await auditCorrection(tx, ctx, "data_correction.rejected", id);
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite support failed");
      throw err;
    }
  });
}
