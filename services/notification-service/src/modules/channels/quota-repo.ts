import { eq, and, lte, gte, sql } from "drizzle-orm";
import { scopedRead, db } from "../../shared/db.js";
import { channelQuotas, type ChannelQuotaRow } from "./quota-schema.js";

export async function findAllForTenant(tenantId: string): Promise<ChannelQuotaRow[]> {
  return scopedRead((tx) =>
    tx.select().from(channelQuotas).where(eq(channelQuotas.tenantId, tenantId)),
  );
}

export async function findCurrentQuota(
  tenantId: string,
  channel: string,
  today: string,
): Promise<ChannelQuotaRow | undefined> {
  const rows = await scopedRead((tx) =>
    tx.select().from(channelQuotas)
      .where(and(
        eq(channelQuotas.tenantId, tenantId),
        eq(channelQuotas.channel, channel),
        lte(channelQuotas.periodStart, today),
        gte(channelQuotas.periodEnd, today),
      ))
      .limit(1),
  );
  return rows[0];
}

export async function upsertQuota(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  row: typeof channelQuotas.$inferInsert,
): Promise<ChannelQuotaRow> {
  // Upsert based on unique (tenant_id, channel, period_start)
  const existing = await tx.select().from(channelQuotas)
    .where(and(
      eq(channelQuotas.tenantId, row.tenantId),
      eq(channelQuotas.channel, row.channel),
      eq(channelQuotas.periodStart, row.periodStart as string),
    ))
    .limit(1);

  if (existing[0]) {
    const updates: Record<string, unknown> = {
      monthlyLimit: row.monthlyLimit,
      periodEnd: row.periodEnd,
      updatedBy: row.updatedBy,
      updatedAt: new Date(),
    };
    if (row.status !== undefined) {
      updates.status = row.status;
    }
    const [updated] = await tx.update(channelQuotas)
      .set(updates)
      .where(eq(channelQuotas.id, existing[0].id))
      .returning();
    return updated!;
  }

  const [inserted] = await tx.insert(channelQuotas).values(row).returning();
  return inserted!;
}

/**
 * Increment the `used` counter for the current period. Called by the delivery
 * consumer AFTER a successful send — only real deliveries are metered.
 */
export async function incrementUsed(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  channel: string,
  today: string,
): Promise<void> {
  await tx.update(channelQuotas)
    .set({
      used: sql`${channelQuotas.used} + 1`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(channelQuotas.tenantId, tenantId),
      eq(channelQuotas.channel, channel),
      lte(channelQuotas.periodStart, today),
      gte(channelQuotas.periodEnd, today),
    ));
}
