import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import { computeStipend } from "./domain.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-apprentice-stipend" });
export function registerF3_apprentice_stipend_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "apprentice_stipend_routes__0",
      "apprentice_stipend_routes__1",
      "apprentice_stipend_routes__2",
      "apprentice_stipend_routes__3",
      "apprentice_stipend_routes__4",
      "apprentice_stipend_routes__5",
      "apprentice_stipend_routes__6",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "apprentice_stipend_routes__0": {
            await repo.insertApprenticeship(tx, {
                  id, tenantId: p.tenantId, apprenticeId: body.apprenticeId,
                  napsId: body.napsId ?? (emp.napsId as string | undefined) ?? null,
                  ...(body.trade ? { trade: body.trade } : {}),
                  qualification: body.qualification,
                  monthlyStipendMinor: BigInt(body.monthlyStipendMinor),
                  napsReimbPctBps: body.napsReimbPctBps, napsReimbCapMinor: BigInt(body.napsReimbCapMinor),
                  trainingStart: body.trainingStart,
                  ...(body.trainingEnd ? { trainingEnd: body.trainingEnd } : {}),
                  status: "active", createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "apprentice_stipend_routes__1": {
            await repo.updateApprenticeship(tx, p.tenantId, id, patch, a.version);
            break;
          }
          case "apprentice_stipend_routes__2": {
            await repo.insertStipend(tx, {
                    id: stipendId, tenantId: p.tenantId, apprenticeshipId: id,
                    month: body.month, workingDays: body.workingDays, daysPresent: body.daysPresent,
                    // Snapshot the agreed stipend AND the NAPS rate/cap for THIS period, so a
                    // later edit to the apprenticeship master can't retroactively change how
                    // an already-submitted run is computed at approval.
                    monthlyStipendMinor: a.monthlyStipendMinor,
                    napsReimbPctBps: a.napsReimbPctBps, napsReimbCapMinor: a.napsReimbCapMinor,
                    status: "submitted",
                    ...(body.remarks ? { remarks: body.remarks } : {}),
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });
            break;
          }
          case "apprentice_stipend_routes__3": {
            await repo.updateStipend(tx, p.tenantId, stipendId, {
                  status: "verified", verifiedBy: msg.actorId, verifiedAt: new Date(), updatedBy: msg.actorId,
                }, s.version);
            break;
          }
          case "apprentice_stipend_routes__4": {
            await repo.updateStipend(tx, p.tenantId, stipendId, {
                    status: "approved",
                    grossStipendMinor: stipend.grossStipendMinor,
                    napsReimbMinor: stipend.napsReimbMinor,
                    employerCostMinor: stipend.employerCostMinor,
                    approvedBy: msg.actorId, approvedAt: new Date(),
                    ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                    updatedBy: msg.actorId,
                  }, s.version);
                  await enqueue(tx, {
                    topic: EVENTS.apprenticeStipendApproved, eventType: EVENTS.apprenticeStipendApproved,
                    tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                    payload: {
                      stipendId, apprenticeshipId: s.apprenticeshipId, apprenticeId: a.apprenticeId, napsId: a.napsId,
                      month: s.month, grossStipendMinor: stipend.grossStipendMinor.toString(),
                      napsReimbMinor: stipend.napsReimbMinor.toString(), employerCostMinor: stipend.employerCostMinor.toString(),
                    },
                  });
            break;
          }
          case "apprentice_stipend_routes__5": {
            await repo.updateStipend(tx, p.tenantId, stipendId, {
                  status: "rejected",
                  ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                  updatedBy: msg.actorId,
                }, s.version);
            break;
          }
          case "apprentice_stipend_routes__6": {
            await repo.updateStipend(tx, p.tenantId, stipendId, {
                    status: "paid", paymentRef: body.paymentRef, paidAt: new Date(), updatedBy: msg.actorId,
                  }, s.version);
                  await enqueue(tx, {
                    topic: EVENTS.apprenticeStipendPaid, eventType: EVENTS.apprenticeStipendPaid,
                    tenantId: p.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
                    payload: {
                      stipendId, apprenticeshipId: s.apprenticeshipId, month: s.month,
                      grossStipendMinor: s.grossStipendMinor.toString(), paymentRef: body.paymentRef,
                    },
                  });
            break;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
