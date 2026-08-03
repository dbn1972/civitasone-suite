/**
 * Lead conversion consumer (OP-001) — applies `crm.lead.convert`.
 *
 * Creates the optional account and opportunity, flips the lead to `converted`
 * and links it to the new account, all in one transaction with the outbox so
 * the domain + audit events can never diverge from the rows.
 */
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { markProcessed } from "../../shared/outbox.js";
import { emitWithAudit } from "../../shared/route-audit.js";
import { invalidateDashboard } from "../dashboard/queries.js";
import { COMMANDS, EVENTS } from "../../topics.js";

const log = pino({ name: "crm-conversion-consumer" });

interface ConvertPayload {
  leadId: string;
  leadName: string;
  createAccount: boolean;
  accountName: string | null;
  dealName: string | null;
  dealValue: string | null;
  /** Pre-allocated by the route so a redelivery reuses the same ids. */
  accountId?: string | null;
  dealId?: string | null;
}

const CONVERTIBLE_STATUSES = ["qualified", "converted"];

export function registerConversionConsumer(queue: Queue): void {
  queue.subscribe(COMMANDS.leadConvert, async (msg) => {
    const p = msg.payload as ConvertPayload;
    let accountId: string | null = null;
    let dealId: string | null = null;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;

        // Re-check the invariant the route validated: the command may have sat
        // in the queue while the lead was deleted or moved out of a convertible
        // status. Rejecting here keeps the audit trail honest.
        const leads = (await tx.execute(sql`
          SELECT lead_status AS "leadStatus", owner_id AS "ownerId", account_id AS "accountId"
          FROM crm.contacts
          WHERE id = ${p.leadId} AND tenant_id = ${msg.tenantId} AND status = 'active'
        `)) as unknown as Array<{ leadStatus: string; ownerId: string | null; accountId: string | null }>;
        const lead = leads[0];
        if (!lead || !CONVERTIBLE_STATUSES.includes(lead.leadStatus)) {
          await emitWithAudit(tx, ctxOf(msg), {
            eventType: EVENTS.leadConverted,
            action: "convert",
            resourceType: "contact",
            resourceId: p.leadId,
            payload: { leadId: p.leadId, rejected: true },
            outcome: lead ? "rejected_invalid_status" : "rejected_not_found",
          });
          return;
        }

        if (p.createAccount && p.accountName) {
          accountId = p.accountId ?? randomUUID();
          await tx.execute(sql`
            INSERT INTO crm.accounts (id, tenant_id, name, status, created_by, updated_by)
            VALUES (${accountId}, ${msg.tenantId}, ${p.accountName}, 'active', ${msg.actorId}, ${msg.actorId})
            ON CONFLICT (id) DO NOTHING
          `);
        }

        if (p.dealName) {
          dealId = p.dealId ?? randomUUID();
          await tx.execute(sql`
            INSERT INTO crm.deals (
              id, tenant_id, name, stage, value_minor, currency, contact_id,
              owner_id, probability, status, created_by, updated_by
            ) VALUES (
              ${dealId}, ${msg.tenantId}, ${p.dealName}, 'Lead',
              ${p.dealValue ?? "0"}::bigint, 'INR', ${p.leadId},
              ${lead.ownerId ?? msg.actorId}, 0, 'active', ${msg.actorId}, ${msg.actorId}
            )
            ON CONFLICT (id) DO NOTHING
          `);
        }

        await tx.execute(sql`
          UPDATE crm.contacts
          SET lead_status = 'converted',
              account_id = COALESCE(${accountId}, account_id),
              last_activity_at = now(),
              updated_at = now(),
              updated_by = ${msg.actorId},
              version = version + 1
          WHERE id = ${p.leadId} AND tenant_id = ${msg.tenantId} AND status = 'active'
        `);

        await emitWithAudit(tx, ctxOf(msg), {
          eventType: EVENTS.leadConverted,
          action: "convert",
          resourceType: "contact",
          resourceId: p.leadId,
          payload: {
            leadId: p.leadId,
            fromStatus: lead.leadStatus,
            accountId,
            dealId,
            dealValueMinor: p.dealValue,
          },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "leadConvert failed");
      throw err;
    }

    await cache.invalidate(cache.makeKey(msg.tenantId, "contact", p.leadId));
    await cache.invalidateResource(msg.tenantId, "contact");
    if (accountId) await cache.invalidateResource(msg.tenantId, "account");
    if (dealId) {
      await cache.invalidateResource(msg.tenantId, "deal");
      await invalidateDashboard(msg.tenantId);
    }
  });
}

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return {
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
  } as Parameters<typeof emitWithAudit>[1];
}
