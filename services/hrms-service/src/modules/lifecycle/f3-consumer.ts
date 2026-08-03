// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsOnboardingTasks, hrmsBuddyAssignments } from "./schema.js";
import { hrmsBgvChecks, hrmsPropertyReturns, hrmsMandatoryDocConfigs, hrmsPolicyAcknowledgements } from "./schema.js";
import { hrmsEmployeeHolds } from "./schema.js";
import { hrmsEmployees } from "../employee/schema.js";
const log = pino({ name: "hrms-f3-lifecycle" });
export function registerF3_lifecycle_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "lifecycle_bgv_property_policy_routes__0",
      "lifecycle_bgv_property_policy_routes__1",
      "lifecycle_bgv_property_policy_routes__2",
      "lifecycle_bgv_property_policy_routes__3",
      "lifecycle_bgv_property_policy_routes__4",
      "lifecycle_bgv_property_policy_routes__5",
      "lifecycle_hold_routes__0",
      "lifecycle_hold_routes__1",
      "lifecycle_hold_routes__2",
      "lifecycle_hold_routes__3",
      "lifecycle_onboarding_routes__0",
      "lifecycle_onboarding_routes__1",
      "lifecycle_onboarding_routes__2",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "lifecycle_bgv_property_policy_routes__0": {
            await tx.insert(hrmsBgvChecks).values({
                  id: bid, tenantId: p.tenantId, employeeId: id,
                  checkType: body.checkType, provider: body.provider ?? null, createdBy: msg.actorId,
                });
            break;
          }
          case "lifecycle_bgv_property_policy_routes__1": {
            await tx.update(hrmsBgvChecks)
                  .set({ status: body.status, result: body.result ?? null, completedAt: new Date(), version: sql`${hrmsBgvChecks.version} + 1` })
                  .where(and(eq(hrmsBgvChecks.tenantId, p.tenantId), eq(hrmsBgvChecks.id, id)));
            break;
          }
          case "lifecycle_bgv_property_policy_routes__2": {
            await tx.insert(hrmsPropertyReturns).values({
                  id: pid, tenantId: p.tenantId, employeeId: id, itemDescription: body.itemDescription, createdBy: msg.actorId,
                });
            break;
          }
          case "lifecycle_bgv_property_policy_routes__3": {
            await tx.update(hrmsPropertyReturns)
                  .set({ returnStatus: "returned", returnedAt: new Date(), verifiedBy: msg.actorId, version: sql`${hrmsPropertyReturns.version} + 1` })
                  .where(and(eq(hrmsPropertyReturns.tenantId, p.tenantId), eq(hrmsPropertyReturns.id, id)));
            break;
          }
          case "lifecycle_bgv_property_policy_routes__4": {
            await tx.insert(hrmsMandatoryDocConfigs).values({
                  id: mid, tenantId: p.tenantId, employeeType: body.employeeType, docType: body.docType, required: body.required, createdBy: msg.actorId,
                });
            break;
          }
          case "lifecycle_bgv_property_policy_routes__5": {
            await tx.insert(hrmsPolicyAcknowledgements).values({
                  id: pid, tenantId: p.tenantId, employeeId: id,
                  policyName: body.policyName, policyVersion: body.policyVersion ?? null, createdBy: msg.actorId,
                });
            break;
          }
          case "lifecycle_hold_routes__0": {
            await tx.insert(hrmsEmployeeHolds).values({
                    id: holdId,
                    tenantId: p.tenantId,
                    employeeId: id,
                    holdType: body.holdType,
                    reason: body.reason,
                    status: "pending",
                    requestedBy: msg.actorId,
                    effectiveFrom: body.effectiveFrom,
                    ...(body.effectiveTo ? { effectiveTo: body.effectiveTo } : {}),
                  });
            break;
          }
          case "lifecycle_hold_routes__1": {
            const rows = await tx.select().from(hrmsEmployeeHolds)
                    .where(and(eq(hrmsEmployeeHolds.id, holdId), eq(hrmsEmployeeHolds.tenantId, p.tenantId)))
                    .limit(1);
                  const hold = rows[0];
                  if (!hold) throw new HttpError(404, "NOT_FOUND", "hold not found");
                  if (hold.status !== "pending") {
                    throw new HttpError(409, "WRONG_STATE", `hold is '${hold.status}', not 'pending'`);
                  }
                  // Separation of duties: approver cannot be the requester
                  if (hold.requestedBy === msg.actorId) {
                    throw new HttpError(403, "SOD_VIOLATION", "approver must not be the same person who requested the hold");
                  }
                  await tx.update(hrmsEmployeeHolds)
                    .set({
                      status: "active",
                      approvedBy: msg.actorId,
                      approvedAt: new Date(),
                      updatedAt: new Date(),
                    })
                    .where(and(eq(hrmsEmployeeHolds.id, holdId), eq(hrmsEmployeeHolds.version, hold.version)));
            break;
          }
          case "lifecycle_hold_routes__2": {
            const rows = await tx.select().from(hrmsEmployeeHolds)
                    .where(and(eq(hrmsEmployeeHolds.id, holdId), eq(hrmsEmployeeHolds.tenantId, p.tenantId)))
                    .limit(1);
                  const hold = rows[0];
                  if (!hold) throw new HttpError(404, "NOT_FOUND", "hold not found");
                  if (hold.status !== "pending") {
                    throw new HttpError(409, "WRONG_STATE", `hold is '${hold.status}', not 'pending'`);
                  }
                  await tx.update(hrmsEmployeeHolds)
                    .set({
                      status: "rejected",
                      approvedBy: msg.actorId,
                      updatedAt: new Date(),
                      ...(body.reason ? { releaseReason: body.reason } : {}),
                    })
                    .where(and(eq(hrmsEmployeeHolds.id, holdId), eq(hrmsEmployeeHolds.version, hold.version)));
            break;
          }
          case "lifecycle_hold_routes__3": {
            const rows = await tx.select().from(hrmsEmployeeHolds)
                    .where(and(eq(hrmsEmployeeHolds.id, holdId), eq(hrmsEmployeeHolds.tenantId, p.tenantId)))
                    .limit(1);
                  const hold = rows[0];
                  if (!hold) throw new HttpError(404, "NOT_FOUND", "hold not found");
                  if (hold.status !== "active" && hold.status !== "approved") {
                    throw new HttpError(409, "WRONG_STATE", `hold is '${hold.status}', must be 'active' or 'approved' to release`);
                  }
                  await tx.update(hrmsEmployeeHolds)
                    .set({
                      status: "released",
                      releasedBy: msg.actorId,
                      releasedAt: new Date(),
                      releaseReason: body.reason,
                      updatedAt: new Date(),
                    })
                    .where(and(eq(hrmsEmployeeHolds.id, holdId), eq(hrmsEmployeeHolds.version, hold.version)));
            break;
          }
          case "lifecycle_onboarding_routes__0": {
            await tx.insert(hrmsOnboardingTasks).values({
                  id: tid, tenantId: p.tenantId, employeeId: id,
                  title: body.title, dueByDay: body.dueByDay, assignedTo: body.assignedTo ?? null,
                  createdBy: msg.actorId,
                });
            break;
          }
          case "lifecycle_onboarding_routes__1": {
            await tx.update(hrmsOnboardingTasks)
                  .set({ status: "completed", completedAt: new Date(), version: sql`${hrmsOnboardingTasks.version} + 1` })
                  .where(and(eq(hrmsOnboardingTasks.tenantId, p.tenantId), eq(hrmsOnboardingTasks.id, taskId)));
            break;
          }
          case "lifecycle_onboarding_routes__2": {
            await tx.insert(hrmsBuddyAssignments).values({
                  id: bid, tenantId: p.tenantId, employeeId: id, ...body, createdBy: msg.actorId,
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
