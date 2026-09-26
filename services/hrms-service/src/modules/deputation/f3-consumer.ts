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

/**
 * Shared close logic for repatriate (op "deputation_routes__1") and cancel
 * (op "deputation_routes__2"). `newStatus` is always a literal supplied by
 * the caller at the bottom of this file -- one call site per op, never
 * derived from message content -- so there is no path back to the original
 * ambiguity this fixes (see TODO(unresolved-f3-bug) history in routes.ts).
 */
async function closeDeputationCommand(
  tx: repo.Writer,
  tenantId: string,
  depId: string,
  newStatus: "repatriated" | "cancelled",
  body: Record<string, any>,
  actorId: string,
): Promise<void> {
  // findByIdTx (NOT the scopedRead-based findById) reads through the
  // caller's already-open tx -- same nested-tx deadlock shape as the
  // deputation_routes__0 fix above and documented in
  // .claude/skills/16-production-readiness-audit.md section 1. The old
  // TODO's own sketch of this fix called plain `repo.findById(...)`, which
  // would have reintroduced exactly that deadlock; use findByIdTx instead.
  const dep = await repo.findByIdTx(tx, tenantId, depId);
  if (!dep) return; // deputation no longer exists -- nothing to close.
  // Already closed by an earlier delivery of this (or the other) command --
  // the route's own mustDeputation/409 guard normally prevents this, but
  // staying idempotent here is cheap and avoids a spurious version-conflict
  // throw on a harmless redelivery.
  if (dep.status !== "active") return;

  const effectiveDate = (body.repatriatedOn as string | undefined) ?? new Date().toISOString().slice(0, 10);

  await repo.closeDeputation(tx, tenantId, depId, {
    status: newStatus,
    repatriatedOn: effectiveDate,
    ...(body.note ? { repatriationNote: body.note as string } : {}),
    updatedBy: actorId,
  }, dep.version);

  // Restore the parent posting/reporting snapshot.
  await tx.update(hrmsEmployees).set({
    departmentId: dep.parentDepartmentId,
    managerId: dep.parentManagerId,
    updatedBy: actorId,
  }).where(and(eq(hrmsEmployees.id, dep.employeeId), eq(hrmsEmployees.tenantId, tenantId)));

  await tx.insert(hrmsServiceBookEntries).values({
    tenantId, employeeId: dep.employeeId,
    entryType: newStatus === "repatriated" ? "repatriation" : "deputation_cancelled",
    effectiveDate,
    description: newStatus === "repatriated"
      ? `Repatriated from ${dep.borrowingDepartment} back to parent cadre ${dep.parentCadre}`
      : `Deputation to ${dep.borrowingDepartment} cancelled`,
    recordedBy: actorId,
  });
}

export function registerF3_deputation_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "deputation_routes__0",
      "deputation_routes__1",
      "deputation_routes__2",
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
            // Read through the caller's already-open tx directly -- this used
            // to call the module-level scopedRead(...) helper inline, which
            // opens its OWN transaction from inside this already-open
            // db.transaction(), the same nested-tx deadlock shape documented
            // in .claude/skills/16-production-readiness-audit.md section 1.
            const empRows = await tx.select().from(hrmsEmployees)
              .where(and(eq(hrmsEmployees.id, employeeId), eq(hrmsEmployees.tenantId, p.tenantId)))
              .limit(1);
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
            // Repatriate. Was previously ambiguous with cancel under the same
            // shared op (see git history / TODO(unresolved-f3-bug)); routes.ts
            // now publishes this op ONLY for POST .../repatriate, so the
            // terminal status below is a literal, not a guess.
            const depId = String(params.depId ?? "");
            await closeDeputationCommand(tx, p.tenantId, depId, "repatriated", body, msg.actorId);
            break;
          }
          case "deputation_routes__2": {
            // Cancel. Mirrors deputation_routes__1 above with the other
            // terminal status; routes.ts publishes this op ONLY for
            // POST .../cancel.
            const depId = String(params.depId ?? "");
            await closeDeputationCommand(tx, p.tenantId, depId, "cancelled", body, msg.actorId);
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
