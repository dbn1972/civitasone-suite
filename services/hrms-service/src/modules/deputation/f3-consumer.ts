// @ts-nocheck — RETAINED ONLY for case `deputation_routes__1`, which cannot be
// reconstructed from the queued payload (see the TODO(unresolved-f3-bug) on that
// case). `deputation_routes__0` below is fully repaired and type-correct; drop
// this banner as soon as __1 is fixed at the route.
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
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
    // Both routes call `publishF3Write(ctx, op, randomUUID(), …)`, so `p.id`
    // (and therefore `id` above) is a FRESH uuid minted at publish time — it is
    // NEVER the `:id`/`:depId` from the URL. `id` is only safe as the primary
    // key of a brand-new row; anything addressing an EXISTING row must use the
    // path param.
    const employeeId = String(params.id ?? "");
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "deputation_routes__0": {
            // F3 codegen repair (same bug class as leave/f3-consumer.ts
            // `leave_policy_admin_routes__0`): the generator dropped the route's
            // `const depId = randomUUID()` and its `mustEmployee(...)` fetch, so
            // `depId` and `emp` were referenced but never defined. Deputing an
            // employee OUT threw a ReferenceError here on every call — after the
            // route had already answered 201 with the deputation body. No
            // deputation row, no posting/reporting switch, and no service-book
            // entry were ever written.
            //
            // `emp` supplies the PARENT posting snapshot (departmentId /
            // managerId) that repatriation later restores, so it must be the
            // employee row as it stands BEFORE the update below.
            const depId = id;
            const empRows = await scopedRead((rtx) => rtx.select().from(hrmsEmployees)
              .where(and(eq(hrmsEmployees.id, employeeId), eq(hrmsEmployees.tenantId, p.tenantId)))
              .limit(1));
            const emp = empRows[0];
            // The route already 404'd on a missing employee and 409'd on an
            // existing active deputation before publishing.
            if (!emp) return;

            await repo.insertDeputation(tx, {
                    id: depId, tenantId: p.tenantId, employeeId,
                    parentCadre: body.parentCadre,
                    parentDepartmentId: emp.departmentId,
                    ...(emp.managerId ? { parentManagerId: emp.managerId } : {}),
                    borrowingDepartment: body.borrowingDepartment,
                    ...(body.borrowingDepartmentId ? { borrowingDepartmentId: body.borrowingDepartmentId } : {}),
                    ...(body.borrowingManagerId ? { borrowingManagerId: body.borrowingManagerId } : {}),
                    deputationAllowanceMinor: BigInt(body.deputationAllowanceMinor ?? 0),
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
                    .where(and(eq(hrmsEmployees.id, employeeId), eq(hrmsEmployees.tenantId, p.tenantId)));

                  await tx.insert(hrmsServiceBookEntries).values({
                    tenantId: p.tenantId, employeeId, entryType: "deputation_out",
                    effectiveDate: body.tenureFrom,
                    description: `Deputed to ${body.borrowingDepartment} (parent cadre ${body.parentCadre}) from ${body.tenureFrom} to ${body.tenureTo}`
                      + (body.deputationAllowanceMinor > 0 ? `, deputation allowance Rs ${(body.deputationAllowanceMinor / 100).toLocaleString("en-IN")}/month` : ""),
                    recordedBy: msg.actorId,
                    ...(body.orderRef ? { documentRef: body.orderRef } : {}),
                  });
            break;
          }
          case "deputation_routes__1": {
            // TODO(unresolved-f3-bug): STILL BROKEN — throws a ReferenceError on
            // every invocation (`depId`, `dep`, `newStatus`, `effectiveDate` are
            // never defined) while the route already answered 200. Deputations
            // are therefore NEVER closed: status stays "active", the parent
            // posting/reporting is never restored, and no service-book entry is
            // written.
            //
            // `depId`, `dep` and `effectiveDate` ARE recoverable here
            // (params.depId → repo.findById → body.repatriatedOn ?? today), but
            // `newStatus` is NOT, and it is the value that decides whether this
            // is a repatriation or a cancellation:
            //
            //   deputation/routes.ts wires BOTH endpoints to the same shared
            //   `close()` helper, which publishes the SAME op string for both:
            //     POST /v1/hrms/deputations/:depId/repatriate → close(…, "repatriated")
            //     POST /v1/hrms/deputations/:depId/cancel     → close(…, "cancelled")
            //     → both: publishF3Write(ctx, "deputation_routes__1", …)
            //   and the queued payload carries only { body, params, query }.
            //   params is `{ depId }` and body is `{ repatriatedOn?, note? }` for
            //   both — nothing in the message distinguishes the two endpoints.
            //
            // Guessing would write the wrong terminal status and the wrong
            // service-book entry type ("repatriation" vs "deputation_cancelled")
            // onto a real service record, so this case is deliberately left
            // failing rather than silently wrong.
            //
            // FIX AT THE ROUTE (outside this file's scope): either give the two
            // endpoints distinct op strings (`deputation_routes__1` /
            // `deputation_routes__2`), or have `close()` forward `newStatus` in
            // the published payload. Then reconstruct this case as:
            //   const dep = await repo.findById(p.tenantId, String(params.depId));
            //   const effectiveDate = body.repatriatedOn ?? new Date().toISOString().slice(0, 10);
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
