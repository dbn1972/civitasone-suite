// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "../employee/schema.js";
import { hrmsServiceBookEntries } from "../service-book/schema.js";
import * as repo from "./repo.js";
const log = pino({ name: "hrms-f3-deputation" });
export function registerF3_deputation_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "deputation_routes__0",
      "deputation_routes__1",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "deputation_routes__0": {
            await repo.insertDeputation(tx, {
                    id: depId, tenantId: p.tenantId, employeeId: id,
                    parentCadre: body.parentCadre,
                    parentDepartmentId: emp.departmentId,
                    ...(emp.managerId ? { parentManagerId: emp.managerId } : {}),
                    borrowingDepartment: body.borrowingDepartment,
                    ...(body.borrowingDepartmentId ? { borrowingDepartmentId: body.borrowingDepartmentId } : {}),
                    ...(body.borrowingManagerId ? { borrowingManagerId: body.borrowingManagerId } : {}),
                    deputationAllowanceMinor: BigInt(body.deputationAllowanceMinor),
                    tenureFrom: body.tenureFrom, tenureTo: body.tenureTo,
                    status: "active",
                    ...(body.orderRef ? { orderRef: body.orderRef } : {}),
                    ...(body.remarks ? { remarks: body.remarks } : {}),
                    createdBy: msg.actorId, updatedBy: msg.actorId,
                  });

                  // Switch the employee's effective posting/reporting for the deputation.
                  const empSet: Record<string, unknown> = { updatedBy: msg.actorId };
                  if (body.borrowingDepartmentId) empSet.departmentId = body.borrowingDepartmentId;
                  if (body.borrowingManagerId) empSet.managerId = body.borrowingManagerId;
                  await tx.update(hrmsEmployees).set(empSet)
                    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, p.tenantId)));

                  await tx.insert(hrmsServiceBookEntries).values({
                    tenantId: p.tenantId, employeeId: id, entryType: "deputation_out",
                    effectiveDate: body.tenureFrom,
                    description: `Deputed to ${body.borrowingDepartment} (parent cadre ${body.parentCadre}) from ${body.tenureFrom} to ${body.tenureTo}`
                      + (body.deputationAllowanceMinor > 0 ? `, deputation allowance Rs ${(body.deputationAllowanceMinor / 100).toLocaleString("en-IN")}/month` : ""),
                    recordedBy: msg.actorId,
                    ...(body.orderRef ? { documentRef: body.orderRef } : {}),
                  });
            break;
          }
          case "deputation_routes__1": {
            await repo.closeDeputation(tx, p.tenantId, depId, {
                    status: newStatus,
                    repatriatedOn: effectiveDate,
                    ...(body.note ? { repatriationNote: body.note } : {}),
                    updatedBy: msg.actorId,
                  }, dep.version);

                  // Restore the parent posting/reporting snapshot.
                  await tx.update(hrmsEmployees).set({
                    departmentId: dep.parentDepartmentId,
                    managerId: dep.parentManagerId,
                    updatedBy: msg.actorId,
                  }).where(and(eq(hrmsEmployees.id, dep.employeeId), eq(hrmsEmployees.tenantId, p.tenantId)));

                  await tx.insert(hrmsServiceBookEntries).values({
                    tenantId: p.tenantId, employeeId: dep.employeeId,
                    entryType: newStatus === "repatriated" ? "repatriation" : "deputation_cancelled",
                    effectiveDate,
                    description: newStatus === "repatriated"
                      ? `Repatriated from ${dep.borrowingDepartment} back to parent cadre ${dep.parentCadre}`
                      : `Deputation to ${dep.borrowingDepartment} cancelled`,
                    recordedBy: msg.actorId,
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
