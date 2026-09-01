import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { hrmsOnboardingTasks, hrmsBuddyAssignments } from "./schema.js";
import { hrmsBgvChecks, hrmsPropertyReturns, hrmsMandatoryDocConfigs, hrmsPolicyAcknowledgements } from "./schema.js";
import { hrmsEmployeeHolds } from "./schema.js";
import { hrmsEmployees } from "../employee/schema.js";
const log = pino({ name: "hrms-f3-lifecycle" });

/**
 * F3 leftover write consumer for the lifecycle module.
 *
 * ── Bug class fixed here (same shape as `leave_policy_admin_routes__0`) ──
 * The generator that stubbed these routes down to a bare `publishF3Write(...)`
 * dropped the "set up the locals" preamble each handler had. Every case below
 * closed over a local that exists only in the route file and is NEVER defined
 * in this file (`bid`, `pid`, `mid`, `holdId`, `tid`, `taskId`), so the handler
 * threw `ReferenceError: <x> is not defined` on the very first line it ran.
 * Because the HTTP route answers 200/201 the moment the message is queued
 * (fire-and-forget), every one of these writes was a fake success: the caller
 * was told "created"/"completed" while this consumer crashed before touching
 * the database. All thirteen ops were 100% dead.
 *
 * ── Reconstruction rules used below ──
 *  - `id` (i.e. `p.id`) is the queued message's entity id and is the PRIMARY KEY
 *    for the row an INSERT case creates. This matches the already-hand-corrected
 *    `disciplinary_routes__3`, which publishes its own `suspId` as that argument.
 *  - The entity a case MUTATES is identified by the ROUTE PATH PARAM, never by
 *    `p.id`. `const id = p.id || params.id` (above) always resolves to `p.id`
 *    because the generated routes pass a fresh `randomUUID()` there, so an
 *    update keyed off `id` would match zero rows and silently no-op. Update
 *    cases therefore read `params.id` / `params.holdId` / `params.taskId`
 *    explicitly.
 *  - Child rows created under `/employees/:id/...` take their `employeeId` from
 *    `params.id` for the same reason (`id` there is the new row's own PK).
 *
 * KNOWN REMAINING DEFECT (route-side, out of scope for this file): the create
 * routes generate their own uuid, return it to the caller, and then publish an
 * UNRELATED `randomUUID()` as the message id — so the id the caller receives is
 * not the id persisted here. `disciplinary_routes__3` shows the intended
 * contract (publish the route's own id). Until the create routes are corrected
 * the same way, a caller cannot act on the row it just created.
 */
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
            // POST /v1/hrms/employees/:id/bgv-checks
            const bid = id;
            const employeeId = String(params.id ?? "");
            await tx.insert(hrmsBgvChecks).values({
                  id: bid, tenantId: p.tenantId, employeeId,
                  checkType: body.checkType, provider: body.provider ?? null, createdBy: msg.actorId,
                });
            break;
          }
          case "lifecycle_bgv_property_policy_routes__1": {
            // PATCH /v1/hrms/bgv-checks/:id/complete
            const checkId = String(params.id ?? "");
            await tx.update(hrmsBgvChecks)
                  .set({ status: body.status, result: body.result ?? null, completedAt: new Date(), version: sql`${hrmsBgvChecks.version} + 1` })
                  .where(and(eq(hrmsBgvChecks.tenantId, p.tenantId), eq(hrmsBgvChecks.id, checkId)));
            break;
          }
          case "lifecycle_bgv_property_policy_routes__2": {
            // POST /v1/hrms/employees/:id/property-returns
            const pid = id;
            const employeeId = String(params.id ?? "");
            await tx.insert(hrmsPropertyReturns).values({
                  id: pid, tenantId: p.tenantId, employeeId, itemDescription: body.itemDescription, createdBy: msg.actorId,
                });
            break;
          }
          case "lifecycle_bgv_property_policy_routes__3": {
            // PATCH /v1/hrms/property-returns/:id/return
            const returnId = String(params.id ?? "");
            await tx.update(hrmsPropertyReturns)
                  .set({ returnStatus: "returned", returnedAt: new Date(), verifiedBy: msg.actorId, version: sql`${hrmsPropertyReturns.version} + 1` })
                  .where(and(eq(hrmsPropertyReturns.tenantId, p.tenantId), eq(hrmsPropertyReturns.id, returnId)));
            break;
          }
          case "lifecycle_bgv_property_policy_routes__4": {
            // POST /v1/hrms/mandatory-doc-configs — `required` mirrors the route's
            // Zod `.default(true)`, because `body` here is the raw pre-Zod payload.
            const mid = id;
            await tx.insert(hrmsMandatoryDocConfigs).values({
                  id: mid, tenantId: p.tenantId, employeeType: body.employeeType, docType: body.docType, required: body.required ?? true, createdBy: msg.actorId,
                });
            break;
          }
          case "lifecycle_bgv_property_policy_routes__5": {
            // POST /v1/hrms/employees/:id/policy-acknowledgements
            const pid = id;
            const employeeId = String(params.id ?? "");
            await tx.insert(hrmsPolicyAcknowledgements).values({
                  id: pid, tenantId: p.tenantId, employeeId,
                  policyName: body.policyName, policyVersion: body.policyVersion ?? null, createdBy: msg.actorId,
                });
            break;
          }
          case "lifecycle_hold_routes__0": {
            // POST /v1/hrms/employees/:id/holds — the new hold's PK is the queued id.
            const holdId = id;
            const employeeId = String(params.id ?? "");
            await tx.insert(hrmsEmployeeHolds).values({
                    id: holdId,
                    tenantId: p.tenantId,
                    employeeId,
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
            // POST /v1/hrms/holds/:holdId/approve
            const holdId = String(params.holdId ?? "");
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
            // POST /v1/hrms/holds/:holdId/reject
            const holdId = String(params.holdId ?? "");
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
            // POST /v1/hrms/holds/:holdId/release
            const holdId = String(params.holdId ?? "");
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
            // POST /v1/hrms/employees/:id/onboarding-tasks
            const tid = id;
            const employeeId = String(params.id ?? "");
            await tx.insert(hrmsOnboardingTasks).values({
                  id: tid, tenantId: p.tenantId, employeeId,
                  title: body.title, dueByDay: body.dueByDay, assignedTo: body.assignedTo ?? null,
                  createdBy: msg.actorId,
                });
            break;
          }
          case "lifecycle_onboarding_routes__1": {
            // PATCH /v1/hrms/onboarding-tasks/:taskId/complete
            const taskId = String(params.taskId ?? "");
            await tx.update(hrmsOnboardingTasks)
                  .set({ status: "completed", completedAt: new Date(), version: sql`${hrmsOnboardingTasks.version} + 1` })
                  .where(and(eq(hrmsOnboardingTasks.tenantId, p.tenantId), eq(hrmsOnboardingTasks.id, taskId)));
            break;
          }
          case "lifecycle_onboarding_routes__2": {
            // POST /v1/hrms/employees/:id/buddy — `role` mirrors the route's Zod
            // `.default("buddy")`; `body` is spread last exactly as generated, so
            // an explicit body.role still wins.
            const bid = id;
            const employeeId = String(params.id ?? "");
            await tx.insert(hrmsBuddyAssignments).values({
                  id: bid, tenantId: p.tenantId, employeeId, role: "buddy", ...body, createdBy: msg.actorId,
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
