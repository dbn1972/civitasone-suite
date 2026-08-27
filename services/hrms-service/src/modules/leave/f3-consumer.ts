// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsLeaveConversions } from "./schema.js";
import { hrmsLeavePolicyRules } from "./policy-schema.js";
import { hrmsLeaveTypes } from "./schema.js";
const log = pino({ name: "hrms-f3-leave" });
export function registerF3_leave_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "leave_conversion_routes__0",
      "leave_policy_admin_routes__0",
      "leave_policy_admin_routes__1",
      "leave_policy_admin_routes__2",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "leave_conversion_routes__0": {
            await tx.insert(hrmsLeaveConversions).values({
                  id, tenantId: p.tenantId, employeeId: body.employeeId,
                  fromAllocId: body.fromAllocId, toAllocId: body.toAllocId,
                  days: body.days, reason: body.reason ?? null, createdBy: msg.actorId,
                });
            break;
          }
          case "leave_policy_admin_routes__0": {
            // HR-A deep-verify fix: this referenced an undefined `upsertValues`
            // local (a leftover from this file's generated-migration origin —
            // see the @ts-nocheck banner above) and threw a ReferenceError on
            // every single invocation. Because the route already answers 201
            // "created" as soon as the message is queued (fire-and-forget —
            // see policy-admin-routes.ts), every create-policy submission was
            // a fake success: the client was told it worked while this async
            // consumer crashed before ever inserting a row. Defaults below
            // mirror createPolicyBody's Zod .default(...) values field-for-field
            // so behavior matches validation even though `body` here is the
            // raw (pre-Zod-default) request body forwarded through the queue.
            const insertValues = {
              id,
              tenantId: p.tenantId,
              leaveTypeId: body.leaveTypeId,
              employeeType: body.employeeType,
              maxDaysPerYear: body.maxDaysPerYear,
              carryForward: body.carryForward ?? false,
              maxAccumulation: body.maxAccumulation ?? 0,
              encashable: body.encashable ?? false,
              countMethod: body.countMethod ?? "calendar",
              maxContinuousDays: body.maxContinuousDays ?? 365,
              minServiceMonths: body.minServiceMonths ?? 0,
              genderRestriction: body.genderRestriction ?? null,
              requiresMedicalCert: body.requiresMedicalCert ?? false,
              requiresMedicalCertAfterDays: body.requiresMedicalCertAfterDays ?? 3,
              prefixSuffixRule: body.prefixSuffixRule ?? false,
              sandwichRule: body.sandwichRule ?? false,
              proRataOnJoining: body.proRataOnJoining ?? true,
              createdBy: msg.actorId,
              updatedBy: msg.actorId,
            };
            await tx.insert(hrmsLeavePolicyRules).values(insertValues)
                  .onConflictDoUpdate({
                    target: [hrmsLeavePolicyRules.tenantId, hrmsLeavePolicyRules.leaveTypeId, hrmsLeavePolicyRules.employeeType],
                    set: {
                      maxDaysPerYear: body.maxDaysPerYear,
                      carryForward: body.carryForward,
                      maxAccumulation: body.maxAccumulation,
                      encashable: body.encashable,
                      countMethod: body.countMethod,
                      maxContinuousDays: body.maxContinuousDays,
                      minServiceMonths: body.minServiceMonths,
                      genderRestriction: body.genderRestriction,
                      requiresMedicalCert: body.requiresMedicalCert,
                      requiresMedicalCertAfterDays: body.requiresMedicalCertAfterDays,
                      prefixSuffixRule: body.prefixSuffixRule,
                      sandwichRule: body.sandwichRule,
                      proRataOnJoining: body.proRataOnJoining,
                      updatedBy: msg.actorId,
                      updatedAt: new Date(),
                      isActive: true,
                    },
                  })
                  .returning({ id: hrmsLeavePolicyRules.id });
            break;
          }
          case "leave_policy_admin_routes__1": {
            const existing = await tx.select().from(hrmsLeavePolicyRules)
                    .where(and(eq(hrmsLeavePolicyRules.id, id), eq(hrmsLeavePolicyRules.tenantId, p.tenantId))).limit(1);
                  if (!existing[0]) throw new HttpError(404, "NOT_FOUND", "policy rule not found");

                  await tx.update(hrmsLeavePolicyRules)
                    .set({ ...body, updatedBy: msg.actorId, updatedAt: new Date() } as any)
                    .where(and(eq(hrmsLeavePolicyRules.id, id), eq(hrmsLeavePolicyRules.tenantId, p.tenantId)));
            break;
          }
          case "leave_policy_admin_routes__2": {
            await tx.update(hrmsLeavePolicyRules)
                  .set({ isActive: false, updatedBy: msg.actorId, updatedAt: new Date() } as any)
                  .where(and(eq(hrmsLeavePolicyRules.id, id), eq(hrmsLeavePolicyRules.tenantId, p.tenantId)));
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
