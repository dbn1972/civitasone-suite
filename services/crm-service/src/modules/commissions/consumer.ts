/**
 * Gap 1 — Commission consumer: on deal closed (won), compute commission
 * from matching rules and insert into ledger.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue, stableUuid } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { computeCommission, derivePeriod } from "./domain.js";

/**
 * Union of the two payloads that mean "a deal was won":
 *  - crm.deal.closed (deals/close-consumer.ts, OP-006): { dealId, outcome, stage, accountId, closedValueMinor }
 *    (a rejected/duplicate close carries only { dealId, rejected: true } and must be ignored)
 *  - crm.deal.stage_updated (plain stage move): { dealId, previousStage, newStage, ... }
 * This consumer used to read only `newStage`, which the close publisher never sends, so a
 * deal closed through the close command never earned commission.
 */
export interface DealWonPayload {
  dealId: string;
  outcome?: string;
  stage?: string | null;
  previousStage?: string;
  newStage?: string;
  rejected?: boolean;
}

export function reachedWon(p: DealWonPayload): boolean {
  if (p.rejected) return false;
  return p.outcome === "won" || p.stage === "Won" || p.newStage === "Won";
}

const AUDIT_TOPIC = "audit.event.record";

export function registerCommissionConsumers(queue: Queue): void {
  const onDealWon = async (msg: { messageId: string; tenantId: string; actorId: string; correlationId: string; payload: DealWonPayload }): Promise<void> => {
    // Only process deals that ended up Won
    if (!msg.payload.dealId || !reachedWon(msg.payload)) return;

    await db.transaction(async (tx) => {
      // Dedupe key is per-consumer: _inbox.processed is keyed on message_id alone and the
      // onboarding consumer subscribes to the same crm.deal.closed message (same messageId),
      // so claiming the raw id here made whichever of the two ran second silently skip --
      // the other half of why commissions were never computed.
      if (!(await markProcessed(tx, stableUuid(`commissions:${msg.messageId}`)))) return;

      // Get deal details
      const dealRows = (await tx.execute(sql`
        SELECT id, owner_id, value_minor, currency, tenant_id
        FROM crm.deals
        WHERE id = ${msg.payload.dealId} AND tenant_id = ${msg.tenantId}
      `)) as unknown as Array<{ id: string; owner_id: string; value_minor: string; currency: string; tenant_id: string }>;

      if (dealRows.length === 0) return;
      const deal = dealRows[0]!;
      if (!deal.owner_id) return;

      // Get matching commission rules (type=sale, enabled)
      const rules = (await tx.execute(sql`
        SELECT id, rate_type, rate_value, conditions
        FROM crm.commission_rules
        WHERE tenant_id = ${msg.tenantId} AND enabled = true AND type = 'sale'
      `)) as unknown as Array<{ id: string; rate_type: string; rate_value: string; conditions: Record<string, unknown> }>;

      const period = derivePeriod(new Date());

      for (const rule of rules) {
        const amount = computeCommission(
          BigInt(deal.value_minor),
          { rateType: rule.rate_type, rateValue: BigInt(rule.rate_value) },
        );

        if (amount <= 0n) continue;

        // A deal can be both closed-won and stage-moved to Won (two distinct events):
        // one ledger row per (deal, rule) so it never earns the commission twice.
        const already = (await tx.execute(sql`
          SELECT 1 FROM crm.commission_ledger
          WHERE tenant_id = ${msg.tenantId} AND deal_id = ${deal.id} AND rule_id = ${rule.id}
          LIMIT 1
        `)) as unknown as unknown[];
        if (already.length > 0) continue;

        await tx.execute(sql`
          INSERT INTO crm.commission_ledger (tenant_id, agent_id, deal_id, rule_id, amount_minor, currency, status, period)
          VALUES (${msg.tenantId}, ${deal.owner_id}, ${deal.id}, ${rule.id}, ${amount.toString()}, ${deal.currency}, 'pending', ${period})
        `);
      }

      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { service: "crm", action: "compute_commission", resourceType: "commission_ledger", resourceId: msg.payload.dealId, outcome: "success" },
      });
    });
  };

  queue.subscribe<DealWonPayload>(EVENTS.dealClosed, onDealWon);
  queue.subscribe<DealWonPayload>(EVENTS.dealStageUpdated, onDealWon);
}
