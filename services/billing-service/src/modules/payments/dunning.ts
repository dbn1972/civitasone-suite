import { randomUUID } from "node:crypto";
import { sql, eq, and, lt } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { billingSubscriptions } from "../subscriptions/schema.js";
import { billingInvoices } from "../invoices/schema.js";

// ---------------------------------------------------------------------------
// Dunning table reference (raw SQL since Drizzle schema for this table lives
// in the migration — we query via raw SQL for flexibility).
// ---------------------------------------------------------------------------

interface DunningAttempt {
  id: string;
  tenant_id: string;
  subscription_id: string;
  attempt_number: number;
  status: string;
  next_retry_at: string | null;
  [key: string]: unknown;
}

const MAX_RETRY_ATTEMPTS = 3;

/** Number of days after issuedAt before an invoice is considered overdue */
const OVERDUE_GRACE_DAYS = 15;

/**
 * Evaluates subscriptions that have overdue invoices and manages dunning.
 * Called by a scheduled job (cron or queue-driven timer).
 *
 * Logic:
 * 1. Find active subscriptions whose linked invoice is overdue (issued > OVERDUE_GRACE_DAYS ago, still unpaid)
 * 2. For each, check existing dunning attempts
 * 3. If attempt_number < 3 and next_retry_at is past → publish dunningRetry command
 * 4. If attempt_number >= 3 → publish dunningExhausted event (triggers suspension)
 */
export async function evaluateOverdueSubscriptions(): Promise<{ retried: number; exhausted: number }> {
  const now = new Date();
  let retried = 0;
  let exhausted = 0;

  // An invoice is overdue if it was issued more than OVERDUE_GRACE_DAYS ago and not paid
  const overdueCutoff = new Date(now.getTime() - OVERDUE_GRACE_DAYS * 24 * 60 * 60 * 1000);

  // Find active subscriptions with overdue invoices
  const overdueSubscriptions = await db
    .select({
      subscriptionId: billingSubscriptions.id,
      tenantId: billingSubscriptions.tenantId,
      invoiceId: billingInvoices.id,
    })
    .from(billingSubscriptions)
    .innerJoin(
      billingInvoices,
      and(
        eq(billingInvoices.tenantId, billingSubscriptions.tenantId),
        eq(billingInvoices.status, "issued"),
      ),
    )
    .where(
      and(
        eq(billingSubscriptions.status, "active"),
        lt(billingInvoices.issuedAt, overdueCutoff),
      ),
    );

  for (const sub of overdueSubscriptions) {
    // Check existing dunning attempts for this subscription
    const existing = await db.execute<DunningAttempt>(
      sql`SELECT id, tenant_id, subscription_id, attempt_number, status, next_retry_at::text
          FROM payments.billing_dunning_attempts
          WHERE subscription_id = ${sub.subscriptionId}
            AND tenant_id = ${sub.tenantId}
          ORDER BY attempt_number DESC
          LIMIT 1`,
    );

    const rows = existing as unknown as DunningAttempt[];
    const latest = rows[0] ?? null;

    if (!latest) {
      // First dunning attempt — create record and publish retry
      const id = randomUUID();
      const nextRetry = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // 3 days
      await db.execute(
        sql`INSERT INTO payments.billing_dunning_attempts
            (id, tenant_id, subscription_id, attempt_number, status, next_retry_at, created_by, updated_by)
            VALUES (${id}, ${sub.tenantId}, ${sub.subscriptionId}, 1, 'retrying', ${nextRetry.toISOString()}, ${"system"}, ${"system"})`,
      );

      await queue.publish(COMMANDS.dunningRetry, {
        messageId: id,
        type: COMMANDS.dunningRetry,
        tenantId: sub.tenantId,
        actorId: "system",
        correlationId: id,
        schemaVersion: "1.0",
        payload: {
          subscriptionId: sub.subscriptionId,
          invoiceId: sub.invoiceId,
          attemptNumber: 1,
        },
      });
      retried++;
    } else if (latest.status === "exhausted" || latest.status === "recovered") {
      // Already terminal — skip
      continue;
    } else if (latest.attempt_number >= MAX_RETRY_ATTEMPTS) {
      // Exhausted — mark and publish event
      await db.execute(
        sql`UPDATE payments.billing_dunning_attempts
            SET status = 'exhausted', updated_at = now()
            WHERE id = ${latest.id}`,
      );

      await queue.publish(EVENTS.dunningExhausted, {
        messageId: randomUUID(),
        type: EVENTS.dunningExhausted,
        tenantId: sub.tenantId,
        actorId: "system",
        correlationId: latest.id,
        schemaVersion: "1.0",
        payload: {
          subscriptionId: sub.subscriptionId,
          tenantId: sub.tenantId,
          attemptNumber: latest.attempt_number,
          reason: "max_retries_exhausted",
        },
      });
      exhausted++;
    } else {
      // Check if next_retry_at is past
      const retryAt = latest.next_retry_at ? new Date(latest.next_retry_at) : null;
      if (retryAt && retryAt <= now) {
        const nextAttempt = latest.attempt_number + 1;
        const nextRetry = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        const newId = randomUUID();

        await db.execute(
          sql`INSERT INTO payments.billing_dunning_attempts
              (id, tenant_id, subscription_id, attempt_number, status, next_retry_at, created_by, updated_by)
              VALUES (${newId}, ${sub.tenantId}, ${sub.subscriptionId}, ${nextAttempt}, 'retrying', ${nextRetry.toISOString()}, ${"system"}, ${"system"})`,
        );

        await queue.publish(COMMANDS.dunningRetry, {
          messageId: newId,
          type: COMMANDS.dunningRetry,
          tenantId: sub.tenantId,
          actorId: "system",
          correlationId: newId,
          schemaVersion: "1.0",
          payload: {
            subscriptionId: sub.subscriptionId,
            invoiceId: sub.invoiceId,
            attemptNumber: nextAttempt,
          },
        });
        retried++;
      }
    }
  }

  return { retried, exhausted };
}
