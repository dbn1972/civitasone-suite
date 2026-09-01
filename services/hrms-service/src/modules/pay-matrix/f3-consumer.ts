import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
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
            // DELIBERATE NO-OP — do not "repair" this case by re-declaring the
            // missing locals.
            //
            // Unlike the other F3 leftovers, POST /v1/hrms/pay-matrix/annual-increment
            // was never actually stubbed out: routes.ts still runs the whole
            // annual-increment inline (db.update on hrmsEmployees.basicMinor +
            // db.insert into hrmsServiceBookEntries, see routes.ts) and only
            // *afterwards* calls publishF3Write. The generated body that used to
            // live here was a copy of an OLDER revision of that loop — it derived
            // the pay level from basicMinor via ENTRY_PAY_PAISE instead of from the
            // employee's designation, and it had no `nextBasic > currentBasicN`
            // guard. Restoring it would have made every increment run apply TWICE:
            // once synchronously in the route and once again here, off the
            // already-incremented basic, plus a second duplicate service-book
            // entry per employee. On a 7th-CPC payroll that is a real,
            // hard-to-reverse money bug, so the correct fix is to drop the stale
            // duplicate rather than reconstruct it.
            //
            // The op is kept in `ops` (rather than deleted) so the queued message
            // is still consumed and marked processed instead of being retried
            // forever. routes.ts remains the single writer for annual increments.
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
