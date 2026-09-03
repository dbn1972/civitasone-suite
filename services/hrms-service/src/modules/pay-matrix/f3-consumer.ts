import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS } from "../../topics.js";
import * as employeeRepo from "../employee/repo.js";
import { hrmsServiceBookEntries } from "../service-book/schema.js";

const log = pino({ name: "hrms-f3-pay-matrix" });

/** Mirrors routes.ts's IncrementPlanItem — the exact, precomputed decision
 * the route made synchronously. This consumer applies these fields verbatim
 * and never re-derives a pay level or re-walks the pay matrix itself. */
interface IncrementPlanItem {
  employeeId: string;
  level: number;
  fromCell: number;
  toCell: number;
  fromMinor: string;
  toMinor: string;
  description: string;
}

export function registerF3_pay_matrix_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "pay_matrix_routes__0",
    ]);
    if (!ops.has(op)) return;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "pay_matrix_routes__0": {
            // 7th CPC annual increment — applies the EXACT plan routes.ts
            // computed synchronously (see its long comment on the
            // annual-increment route). This case deliberately does NOT
            // re-derive a pay level or re-walk PAY_MATRIX: two earlier
            // attempts at this conversion (see git history) did exactly
            // that, independently, and would have double-applied every
            // increment. Applying a precomputed, exact `toMinor` here
            // removes that failure mode structurally — there is nothing
            // left for this consumer to get wrong about WHAT to write, only
            // WHETHER to write it (below).
            const effectiveDate = String(p.effectiveDate ?? "");
            const plan = Array.isArray(p.plan) ? (p.plan as IncrementPlanItem[]) : [];
            const tenantId = String(p.tenantId ?? "");
            if (!effectiveDate || !tenantId) break;

            for (const item of plan) {
              const employeeId = String(item.employeeId ?? "");
              const fromMinor = Number(item.fromMinor);
              const toMinor = Number(item.toMinor);
              // Defensive validation of the queued payload — never trust it
              // enough to move pay backwards or off a malformed value.
              if (!employeeId || !Number.isFinite(fromMinor) || !Number.isFinite(toMinor) || toMinor < fromMinor) {
                log.warn({ messageId: msg.messageId, employeeId, fromMinor, toMinor }, "pay-matrix increment: skipping malformed plan item");
                continue;
              }

              // Idempotency against a genuine concurrent double-submit (two
              // independently published messages for the same
              // employee+effectiveDate — markProcessed above only dedupes
              // REDELIVERY of this SAME message, not that): insert the
              // service-book row first, conflict-checked against the
              // partial unique index from
              // migrations/0132_pay_matrix_increment_idempotency.sql. Only
              // the first of two racing plans to have its insert land here
              // gets zero-rows-back protection lifted; the loser sees an
              // empty `inserted` and skips the pay write entirely below.
              const inserted = await tx.insert(hrmsServiceBookEntries).values({
                id: randomUUID(),
                tenantId,
                employeeId,
                entryType: "increment",
                effectiveDate,
                description: String(item.description ?? ""),
                recordedBy: msg.actorId,
                attested: false,
              }).onConflictDoNothing({
                target: [hrmsServiceBookEntries.tenantId, hrmsServiceBookEntries.employeeId, hrmsServiceBookEntries.effectiveDate],
                where: sql`entry_type = 'increment'`,
              }).returning({ id: hrmsServiceBookEntries.id });

              if (inserted.length === 0) {
                log.info({ messageId: msg.messageId, employeeId, effectiveDate }, "pay-matrix increment: duplicate for employee+effectiveDate, skipped");
                continue;
              }

              // toMinor === fromMinor happens when the employee was already
              // at the top cell of their level (routes.ts still records the
              // service-book entry above for audit continuity, matching the
              // pre-conversion behaviour, but there is no pay change to
              // apply).
              if (toMinor > fromMinor) {
                // Concurrency guard: `fromMinor` was baked into this plan
                // when the route ran, synchronously, possibly long before
                // this consumer executes. Re-read the employee's CURRENT
                // basicMinor/version now, inside this transaction, rather
                // than trusting the queued fromMinor. Other consumers
                // (promotion, generic employee-update) can also write
                // basicMinor — if one of them landed since this plan was
                // computed, applying `toMinor` verbatim would silently
                // clobber that other pay change with a now-stale plan.
                const emp = await employeeRepo.findVersionForUpdate(tx, employeeId, tenantId);
                if (!emp) {
                  log.warn({ messageId: msg.messageId, employeeId }, "pay-matrix increment: employee not found at write time, skipping");
                  continue;
                }
                if (emp.basicMinor !== BigInt(fromMinor)) {
                  log.error(
                    { messageId: msg.messageId, employeeId, planFromMinor: fromMinor, actualBasicMinor: emp.basicMinor.toString(), toMinor },
                    "pay-matrix increment: employee's basicMinor no longer matches this plan's starting point — another consumer (promotion/update) changed it first; refusing to apply a stale increment",
                  );
                  throw new HttpError(
                    409,
                    "STALE_INCREMENT_PLAN",
                    `employee ${employeeId} basicMinor changed since the increment plan was computed (expected ${fromMinor}, found ${emp.basicMinor})`,
                  );
                }
                await employeeRepo.updateEmployeeVersioned(
                  tx, employeeId, tenantId, emp.version, { basicMinor: BigInt(toMinor) }, msg.actorId,
                );
              }
            }
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
