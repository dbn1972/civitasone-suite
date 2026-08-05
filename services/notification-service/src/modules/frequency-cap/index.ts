/**
 * Gap 4 — Per-contact frequency cap.
 *
 * Before any send, check that the contact has not exceeded the max messages
 * per day. If exceeded, skip the send and mark as `frequency_capped`.
 *
 * Usage in delivery consumer:
 *   const ok = await checkAndIncrementFrequency(tx, tenantId, contactId, channel);
 *   if (!ok) { log.info("frequency_capped"); return; }
 */
import { sql, type SQL } from "drizzle-orm";

const MAX_PER_CONTACT_PER_DAY = Number(process.env.MAX_PER_CONTACT_PER_DAY ?? 3);

export interface FrequencyCapTx {
  execute(query: SQL): Promise<unknown>;
}

/**
 * Atomically checks and increments the contact frequency counter.
 * Returns `true` if send is allowed, `false` if frequency-capped.
 *
 * Must be called within the same transaction as the delivery write.
 */
export async function checkAndIncrementFrequency(
  tx: FrequencyCapTx,
  tenantId: string,
  contactId: string,
  channel: string,
): Promise<boolean> {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // Upsert + check in one atomic statement
  const rows = await tx.execute(sql`
    INSERT INTO notification.contact_frequency (tenant_id, contact_id, channel, period_start, count)
    VALUES (${tenantId}, ${contactId}, ${channel}, ${today}::date, 1)
    ON CONFLICT (tenant_id, contact_id, channel, period_start)
    DO UPDATE SET count = notification.contact_frequency.count + 1
    RETURNING count
  `) as unknown as Array<{ count: number }>;

  const currentCount = rows[0]?.count ?? 0;

  if (currentCount > MAX_PER_CONTACT_PER_DAY) {
    // Rolled back: decrement to maintain accurate count (we already incremented)
    await tx.execute(sql`
      UPDATE notification.contact_frequency
      SET count = count - 1
      WHERE tenant_id = ${tenantId}
        AND contact_id = ${contactId}
        AND channel = ${channel}
        AND period_start = ${today}::date
    `);
    return false;
  }

  return true;
}

export function getMaxPerContactPerDay(): number {
  return MAX_PER_CONTACT_PER_DAY;
}
