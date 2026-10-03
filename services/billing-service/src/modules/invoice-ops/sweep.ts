/**
 * Scheduled invoice reminders (per-tenant setting reminder_overdue_days, default OFF).
 * "Overdue" = the invoice was issued at least N days ago and still has an outstanding balance
 * (VERIFY: invoices carry no due-date column, so the N days run from the issue date).
 * Tenants that enabled it are discovered through the SELECT-only platform-bypass policy on
 * billing_settings (GUC set here, by trusted server code only); everything else runs inside the
 * tenant's own RLS context.
 */
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { and, eq, inArray, lte } from "drizzle-orm";
import { sqlClient, scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { billingInvoices } from "../invoices/schema.js";
import { OPS_COMMANDS } from "./topics.js";
import { fetchTenantAdminRecipients } from "./identity-client.js";
import { SETTLEABLE_STATUSES } from "./domain.js";

export const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000099";

export async function tenantsWithScheduledReminders(): Promise<Array<{ tenantId: string; days: number }>> {
  const rows = await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.platform_bypass', 'true', true)`;
    return sql<Array<{ tenant_id: string; reminder_overdue_days: number }>>`
      SELECT tenant_id, reminder_overdue_days FROM invoices.billing_settings WHERE reminder_overdue_days IS NOT NULL`;
  });
  return rows.map((r) => ({ tenantId: r.tenant_id, days: r.reminder_overdue_days }));
}

export async function runReminderSweep(now: Date = new Date()): Promise<{ tenants: number; queued: number }> {
  let queued = 0;
  const tenants = await tenantsWithScheduledReminders();
  for (const t of tenants) {
    await runWithTenant(t.tenantId, async () => {
      const cutoff = new Date(now.getTime() - t.days * 24 * 3600_000);
      const due = await scopedRead((tx) => tx.select().from(billingInvoices)
        .where(and(eq(billingInvoices.tenantId, t.tenantId), inArray(billingInvoices.status, [...SETTLEABLE_STATUSES]), lte(billingInvoices.issuedAt, cutoff))));
      const open = due.filter((i) => i.totalMinor - i.paidMinor > 0n);
      if (open.length === 0) return;
      const lookup = await fetchTenantAdminRecipients(t.tenantId);
      if (!lookup.ok || lookup.recipients.length === 0) return; // nothing to send to; the next sweep retries
      for (const inv of open) {
        await queue.publish(OPS_COMMANDS.reminderSend, {
          messageId: randomUUID(), type: OPS_COMMANDS.reminderSend, tenantId: t.tenantId, actorId: SYSTEM_ACTOR,
          correlationId: randomUUID(), schemaVersion: "1.0",
          payload: { reminderId: randomUUID(), invoiceId: inv.id, trigger: "scheduled", recipients: lookup.recipients },
        });
        queued++;
      }
    });
  }
  return { tenants: tenants.length, queued };
}

export function startReminderSweep(log: { error: (o: unknown, m: string) => void }, intervalMs = Number(process.env.BILLING_REMINDER_SWEEP_MS ?? 3_600_000)): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    void runReminderSweep().catch((err) => log.error({ err }, "scheduled reminder sweep failed")).finally(() => { running = false; });
  }, intervalMs);
}
