import { eq, and } from "drizzle-orm";
import { scopedRead, db } from "../../shared/db.js";
import { dltTemplates, type DltTemplateRow } from "./schema.js";

export async function findAll(tenantId: string): Promise<DltTemplateRow[]> {
  return scopedRead((tx) =>
    tx.select().from(dltTemplates).where(eq(dltTemplates.tenantId, tenantId)),
  );
}

export async function findById(tenantId: string, id: string): Promise<DltTemplateRow | undefined> {
  const rows = await scopedRead((tx) =>
    tx.select().from(dltTemplates)
      .where(and(eq(dltTemplates.tenantId, tenantId), eq(dltTemplates.id, id)))
      .limit(1),
  );
  return rows[0];
}

export async function findActiveByChannel(tenantId: string, channel: string): Promise<DltTemplateRow[]> {
  return scopedRead((tx) =>
    tx.select().from(dltTemplates)
      .where(and(
        eq(dltTemplates.tenantId, tenantId),
        eq(dltTemplates.channel, channel),
        eq(dltTemplates.status, "active"),
      )),
  );
}

/**
 * Same lookup as `findActiveByChannel`, but reads through an ALREADY-OPEN
 * transaction instead of opening a second one via `scopedRead`. See
 * `quota-repo.ts`'s `findCurrentQuotaInTx` for the full pool-exhaustion
 * deadlock this avoids -- `checkDlt` has the identical shape, called from
 * the same `processSend` send transaction.
 */
export async function findActiveByChannelInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  channel: string,
): Promise<DltTemplateRow[]> {
  return tx.select().from(dltTemplates)
    .where(and(
      eq(dltTemplates.tenantId, tenantId),
      eq(dltTemplates.channel, channel),
      eq(dltTemplates.status, "active"),
    ));
}

export async function insert(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  row: typeof dltTemplates.$inferInsert,
): Promise<DltTemplateRow> {
  const [inserted] = await tx.insert(dltTemplates).values(row).returning();
  return inserted!;
}

export async function updateStatus(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  id: string,
  status: string,
  expiresAt: Date | null | undefined,
  actorId: string,
): Promise<DltTemplateRow | undefined> {
  const updates: Record<string, unknown> = {
    status,
    updatedBy: actorId,
    updatedAt: new Date(),
  };
  if (expiresAt !== undefined) {
    updates.expiresAt = expiresAt;
  }
  const [updated] = await tx.update(dltTemplates)
    .set(updates)
    .where(and(eq(dltTemplates.tenantId, tenantId), eq(dltTemplates.id, id)))
    .returning();
  return updated;
}

export async function remove(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  id: string,
): Promise<boolean> {
  const [deleted] = await tx.delete(dltTemplates)
    .where(and(eq(dltTemplates.tenantId, tenantId), eq(dltTemplates.id, id)))
    .returning();
  return Boolean(deleted);
}
