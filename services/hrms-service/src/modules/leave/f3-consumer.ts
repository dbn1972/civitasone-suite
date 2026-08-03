// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
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
            await tx.insert(hrmsLeavePolicyRules).values(upsertValues)
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
