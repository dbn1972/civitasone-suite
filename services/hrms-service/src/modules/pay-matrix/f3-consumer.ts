// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsDesignations, hrmsEmployees } from "../employee/schema.js";
import { hrmsServiceBookEntries } from "../service-book/schema.js";
const log = pino({ name: "hrms-f3-pay-matrix" });
export function registerF3_pay_matrix_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "pay_matrix_routes__0",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "pay_matrix_routes__0": {
            for (const e of emps) {
                    if (alreadyIncremented.has(e.id)) {
                      skipped += 1;
                      results.push({ employeeId: e.id, status: "already_incremented" });
                      continue;
                    }
                    const basic = Number(e.basicMinor);
                    let lvl = 0;
                    for (const L of sortedLevels) { if ((ENTRY_PAY_PAISE[L] ?? Infinity) <= basic) lvl = L; }
                    if (!lvl) { results.push({ employeeId: e.id, status: "off_matrix" }); continue; }
                    const cells = PAY_MATRIX[lvl] ?? [];
                    let idx = 0;
                    for (let i = 0; i < cells.length; i++) { if ((cells[i] ?? Infinity) <= basic) idx = i; }
                    if (idx + 1 >= cells.length) { results.push({ employeeId: e.id, level: lvl, status: "at_max" }); continue; }
                    const newBasic = cells[idx + 1] ?? basic;
                    results.push({ employeeId: e.id, level: lvl, fromMinor: basic, toMinor: newBasic });
                    if (!body.dryRun) {
                      await tx.update(hrmsEmployees).set({ basicMinor: BigInt(newBasic), updatedBy: msg.actorId })
                        .where(eq(hrmsEmployees.id, e.id));
                      await tx.insert(hrmsServiceBookEntries).values({
                        tenantId: p.tenantId, employeeId: e.id, entryType: "increment",
                        effectiveDate,
                        description: `Annual increment (Level ${lvl}): Rs ${(basic / 100).toLocaleString("en-IN")} -> Rs ${(newBasic / 100).toLocaleString("en-IN")}`,
                        recordedBy: msg.actorId, documentRef: null,
                      });
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
