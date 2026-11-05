import { pino } from "pino";
import { NonRetryableError, type Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { DomainError } from "../masters/domain.js";
import { applyYearEndClose } from "./repo.js";

const log = pino({ name: "finance.year-end.consumer" });

/** UAT T-PERIOD: the year-end close (route-validated; re-validated here inside the transaction, race-safe). */
export function registerYearEndConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.yearEndClose, async (msg) => {
    const p = msg.payload as { tenantId: string; fy: string; reason: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const r = await applyYearEndClose(tx, { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId }, { fy: p.fy, reason: p.reason });
        log.info({ id: msg.messageId, fy: r.fy, next: r.next, openingBalances: r.openingBalanceCount, changed: r.changed, lapseRows: r.lapseRows }, "year-end close done");
      });
    } catch (err) {
      // A rule that no longer holds (a month reopened since the route checked, hand-entered balances...) cannot change
      // on retry: dead-letter it with its reason. Nothing was written (the transaction rolled back).
      if (err instanceof DomainError) throw new NonRetryableError(`[finance/year-end] ${err.message}`, err);
      throw err;
    }
    await cache.invalidateResource(msg.tenantId, "masters");
    await cache.invalidateResource(msg.tenantId, "budgets");
  });
}
