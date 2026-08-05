/**
 * Gap 1 — Commission consumer: on deal closed (won), compute commission
 * from matching rules and insert into ledger.
 */
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { markProcessed, enqueue } from "../../shared/outbox.js";
import { EVENTS } from "../../topics.js";
import { computeCommission, derivePeriod } from "./domain.js";

interface DealClosedPayload {
  dealId: string;
  previousStage?: string;
  newStage: string;
  accountId?: string | null;
  transitionTimestamp?: string;
}

const AUDIT_TOPIC = "audit.event.record";

export function registerCommissionConsumers(queue: Queue): void {
  queue.subscribe<DealClosedPayload>(EVENTS.dealClosed, async (msg) => {
    // Only process deals that closed as Won
    if (msg.payload.newStage !== "Won") return;

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

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
  });
}
