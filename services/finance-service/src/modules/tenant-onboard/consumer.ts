/**
 * finance-service: tenant onboarding consumer.
 *
 * Listens for tenant.tenant.onboarded events and seeds the chart-of-accounts
 * (budget.finance_major_heads) with the standard Indian government HoA major
 * heads (LMMHA, CGA) -- see hoa/standard-major-heads.ts. The master is global, so this is a top-up that
 * normally finds every row already present (migration 0164).
 *
 * Idempotent: the major head code is a PK — duplicate seeds are silently
 * ignored via ON CONFLICT DO NOTHING. Safe to redeliver.
 *
 * These are the canonical CGA major heads covering the core expenditure,
 * receipt, and loan segments required for every government tenant to operate.
 * Tenant-specific sub-heads and minor heads are configured post-onboarding
 * by the finance admin via the HoA management UI.
 */
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { financeMajorHeads } from "../hoa/schema.js";
import { STANDARD_MAJOR_HEADS } from "../hoa/standard-major-heads.js";
import { seedStandardGlHeadsTx } from "../gl/standard-heads.js";
import { seedDefaultDdoTx } from "../masters/ddo-seed.js";

const AUDIT_TOPIC = "audit.event.record";
const TENANT_ONBOARDED = "tenant.tenant.onboarded";

export function registerTenantOnboardConsumers(queue: Queue): void {
  /**
   * tenant.tenant.onboarded → seed the chart-of-accounts for this tenant.
   *
   * Keyed by msg.messageId (the outbox row id) which is stable across relay
   * redeliveries, so markProcessed guarantees exactly-once seeding even if the
   * relay fires multiple times.
   */
  queue.subscribe<{
    tenantId: string;
    adminEmail: string;
    adminName: string;
    edition: string;
  }>(TENANT_ONBOARDED, async (msg) => {
    const p = msg.payload;
    // F89/F91: the tenant's own GL heads that the posting paths resolve by code (depreciation, disposal, billing,
    // revenue, refund, payroll, AP, TDS, deposits); without them every such journal is refused for this tenant.
    // Own transaction, idempotent on its own (ON CONFLICT (tenant_id, code) DO NOTHING -- a redelivery, or a head the
    // tenant already has, is untouched), so it does not depend on the shared major-head seed below succeeding.
    const glHeadsSeeded = await db.transaction(async (tx) => seedStandardGlHeadsTx(tx, p.tenantId ?? msg.tenantId, msg.actorId));
    // UAT b24: a default DDO (DDO000001, the code the bill consumer falls back to) so a new tenant can lodge bills
    // before its admin sets the real DDO. Own transaction + ON CONFLICT DO NOTHING, like the GL heads above.
    await db.transaction(async (tx) => seedDefaultDdoTx(tx, p.tenantId ?? msg.tenantId, msg.actorId));
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return; // idempotent

      // Insert all standard major heads; ON CONFLICT DO NOTHING so re-runs and
      // shared-master scenarios (all tenants on the same DB) are safe.
      for (const head of STANDARD_MAJOR_HEADS) {
        await tx
          .insert(financeMajorHeads)
          .values({
            code:        head.code,
            description: head.description,
            sector:      head.sector,
            accountType: head.accountType,
          })
          .onConflictDoNothing();
      }

      // Audit trail: every mutation must be audited (CLAUDE.md §3).
      await enqueue(tx, {
        topic:         AUDIT_TOPIC,
        eventType:     AUDIT_TOPIC,
        tenantId:      p.tenantId,
        actorId:       msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service:      "finance",
          action:       "seed_chart_of_accounts",
          resourceType: "major_head_master",
          resourceId:   p.tenantId,
          outcome:      "success",
          headsSeeded:  STANDARD_MAJOR_HEADS.length,
          glHeadsSeeded,
        },
      });
    });
  });
}
