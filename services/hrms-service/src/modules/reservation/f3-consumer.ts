import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import {
  hrmsRosters, hrmsRosterPoints, hrmsSanctionedPosts,
  type RosterRow, type SanctionedPostRow,
} from "./schema.js";
const log = pino({ name: "hrms-f3-reservation" });
export function registerF3_reservation_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "reservation_routes__0",
      "reservation_routes__1",
      "reservation_routes__2",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "reservation_routes__0": {
            await tx.insert(hrmsRosters).values({
                  id, tenantId: p.tenantId, cadre: body.cadre, rosterKind: body.rosterKind,
                  rosterSize: body.rosterSize,
                  pctSc: body.pctSc.toFixed(2), pctSt: body.pctSt.toFixed(2),
                  pctObc: body.pctObc.toFixed(2), pctEws: body.pctEws.toFixed(2),
                  pctPwd: body.pctPwd.toFixed(2),
                  cfSc: body.cfSc, cfSt: body.cfSt, cfObc: body.cfObc, cfEws: body.cfEws, cfUr: body.cfUr,
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "reservation_routes__1": {
            await tx.delete(hrmsRosterPoints)
                    .where(and(eq(hrmsRosterPoints.tenantId, p.tenantId), eq(hrmsRosterPoints.rosterId, rid)));
                  for (const p of points) {
                    await tx.insert(hrmsRosterPoints).values({
                      id: randomUUID(), tenantId: p.tenantId, rosterId: rid,
                      pointNo: p.point, category: p.category, filled: false,
                    });
                  }
            break;
          }
          case "reservation_routes__2": {
            await tx.insert(hrmsSanctionedPosts).values({
                  id, tenantId: p.tenantId, cadre: body.cadre,
                  sanctionedStrength: body.sanctionedStrength,
                  ...(body.designationId ? { designationId: body.designationId } : {}),
                  ...(body.payLevel ? { payLevel: body.payLevel } : {}),
                  ...(body.remarks ? { remarks: body.remarks } : {}),
                  createdBy: msg.actorId, updatedBy: msg.actorId,
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
