// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-claims" });
export function registerF3_claims_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "claims_routes__0",
      "claims_routes__1",
      "claims_routes__2",
      "claims_routes__3",
      "claims_routes__4",
      "claims_routes__5",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "claims_routes__0": {
            await repo.updateLtc(tx, p.tenantId, claimId, {
                    status: "approved", approvedFareMinor: approved,
                    decidedAt: new Date(), decidedBy: msg.actorId,
                    ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                    updatedBy: msg.actorId,
                  }, c.version);
            break;
          }
          case "claims_routes__1": {
            await repo.updateLtc(tx, p.tenantId, claimId, {
                    status: "rejected", decidedAt: new Date(), decidedBy: msg.actorId,
                    ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                    updatedBy: msg.actorId,
                  }, c.version);
            break;
          }
          case "claims_routes__2": {
            await repo.updateCea(tx, p.tenantId, claimId, {
                    status: "approved", approvedAmountMinor: approved,
                    decidedAt: new Date(), decidedBy: msg.actorId,
                    ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                    updatedBy: msg.actorId,
                  }, c.version);
            break;
          }
          case "claims_routes__3": {
            await repo.updateCea(tx, p.tenantId, claimId, {
                    status: "rejected", decidedAt: new Date(), decidedBy: msg.actorId,
                    ...(body.approverRemarks ? { approverRemarks: body.approverRemarks } : {}),
                    updatedBy: msg.actorId,
                  }, c.version);
            break;
          }
          case "claims_routes__4": {
            const employeeId = String(params.id ?? "");
            await repo.insertLtc(tx, {
              id,
              tenantId: p.tenantId,
              employeeId,
              blockYear: body.blockYear,
              ltcType: body.ltcType,
              journeyFrom: body.journeyFrom,
              journeyTo: body.journeyTo,
              travelDate: body.travelDate,
              familyMembers: Number(body.familyMembers ?? 1),
              claimedFareMinor: BigInt(body.claimedFareMinor ?? 0),
              entitlementMinor: BigInt(body.entitlementMinor ?? 0),
              status: "submitted",
              ...(body.remarks ? { remarks: body.remarks } : {}),
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
            });
            break;
          }
          case "claims_routes__5": {
            const employeeId = String(params.id ?? "");
            await repo.insertCea(tx, {
              id,
              tenantId: p.tenantId,
              employeeId,
              academicYear: body.academicYear,
              childName: body.childName,
              childRef: body.childRef,
              claimKind: body.claimKind,
              claimedAmountMinor: BigInt(body.claimedAmountMinor ?? 0),
              annualCapMinor: BigInt(body.annualCapMinor ?? 0),
              status: "submitted",
              ...(body.remarks ? { remarks: body.remarks } : {}),
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
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
