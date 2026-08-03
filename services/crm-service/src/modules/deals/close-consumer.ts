/**
 * Deal close consumer (OP-006) — applies `crm.deal.close`.
 *
 * Mirrors the stage-transition convention in repo.ts: stage Won/Lost pins
 * status to won/lost, probability to 100/0, and stamps closed_at. The mandatory
 * loss reason and the realised value are persisted alongside so a closed deal
 * can be reported on without replaying the event log.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { invalidateDashboard } from "../dashboard/queries.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-deal-close-consumer" });
const RESOURCE = "deal";

interface ClosePayload {
  dealId: string;
  outcome: "won" | "lost";
  reason: string;
  closedValue: string | null;
}

export function registerDealCloseConsumer(queue: Queue): void {
  queue.subscribe(COMMANDS.closeDeal, async (msg) => {
    const p = msg.payload as ClosePayload;
    const stage = p.outcome === "won" ? "Won" : "Lost";
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // `stage NOT IN ('Won','Lost')` makes the write the authority on
        // "already closed": a duplicate or racing close leaves the first
        // outcome intact instead of overwriting it.
        const rows = (await tx.execute(sql`
          UPDATE crm.deals
          SET stage = ${stage},
              status = ${p.outcome},
              probability = ${p.outcome === "won" ? 100 : 0},
              closed_at = now(),
              close_reason = ${p.reason === "" ? null : p.reason},
              closed_value_minor = COALESCE(${p.closedValue}::bigint, value_minor),
              updated_at = now(),
              updated_by = ${msg.actorId},
              version = version + 1
          WHERE id = ${p.dealId}
            AND tenant_id = ${msg.tenantId}
            AND stage NOT IN ('Won', 'Lost')
            AND status NOT IN ('deleted', 'cancelled')
          RETURNING closed_value_minor AS "closedValueMinor"
        `)) as unknown as Array<{ closedValueMinor: string }>;

        const row = rows[0];
        if (!row) {
          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.dealClosed,
            action: "close",
            resourceType: RESOURCE,
            resourceId: p.dealId,
            payload: { dealId: p.dealId, rejected: true },
            outcome: "rejected_already_closed_or_missing",
          });
          return;
        }

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.dealClosed,
          action: "close",
          resourceType: RESOURCE,
          resourceId: p.dealId,
          payload: {
            dealId: p.dealId,
            outcome: p.outcome,
            stage,
            closedValueMinor: String(row.closedValueMinor),
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "closeDeal failed");
      throw err;
    }

    await cache.invalidate(cache.makeKey(msg.tenantId, RESOURCE, p.dealId));
    await cache.invalidateResource(msg.tenantId, RESOURCE);
    await invalidateDashboard(msg.tenantId);
  });
}

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as Parameters<typeof emitWithAudit>[1];
}
