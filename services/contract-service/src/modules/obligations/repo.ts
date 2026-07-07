import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  contractObligations,
  obligationReminders,
  type ObligationRow,
  type ObligationInsert,
  type ObligationReminderInsert,
  type ObligationReminderRow,
} from "./schema.js";

async function tenantRead<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as typeof db);
  });
}

export async function insertObligation(obligation: ObligationInsert): Promise<ObligationRow> {
  return tenantRead(obligation.tenantId, async (tx) => {
    const [row] = await tx.insert(contractObligations).values(obligation).returning();
    return row!;
  });
}

export async function insertReminders(records: ObligationReminderInsert[]): Promise<ObligationReminderRow[]> {
  if (records.length === 0) return [];
  const tenantId = records[0]!.tenantId;
  return tenantRead(tenantId, async (tx) => {
    return tx.insert(obligationReminders).values(records).returning();
  });
}

export async function getObligationById(id: string, tenantId: string): Promise<ObligationRow | undefined> {
  return tenantRead(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(contractObligations)
      .where(and(eq(contractObligations.id, id), eq(contractObligations.tenantId, tenantId)))
      .limit(1);
    return row;
  });
}

export async function listObligations(
  tenantId: string,
  opts: { contractId?: string; status?: string; limit: number; offset: number },
): Promise<{ data: ObligationRow[]; total: number }> {
  return tenantRead(tenantId, async (tx) => {
    const conditions = [eq(contractObligations.tenantId, tenantId)];
    if (opts.contractId) conditions.push(eq(contractObligations.contractId, opts.contractId));
    if (opts.status) conditions.push(eq(contractObligations.status, opts.status));

    const where = and(...conditions);

    const [countResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contractObligations)
      .where(where);

    const data = await tx
      .select()
      .from(contractObligations)
      .where(where)
      .orderBy(desc(contractObligations.dueDate))
      .limit(opts.limit)
      .offset(opts.offset);

    return { data, total: countResult?.count ?? 0 };
  });
}

export async function updateObligation(
  id: string,
  tenantId: string,
  currentVersion: number,
  updates: Partial<Pick<ObligationRow, "title" | "description" | "dueDate" | "ownerId" | "status" | "updatedBy">>,
): Promise<ObligationRow | null> {
  return tenantRead(tenantId, async (tx) => {
    const [row] = await tx
      .update(contractObligations)
      .set({
        ...updates,
        version: currentVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contractObligations.id, id),
          eq(contractObligations.tenantId, tenantId),
          eq(contractObligations.version, currentVersion),
        ),
      )
      .returning();
    return row ?? null;
  });
}

export async function getRemindersForObligation(
  obligationId: string,
  tenantId: string,
): Promise<ObligationReminderRow[]> {
  return tenantRead(tenantId, async (tx) => {
    return tx
      .select()
      .from(obligationReminders)
      .where(
        and(
          eq(obligationReminders.obligationId, obligationId),
          eq(obligationReminders.tenantId, tenantId),
        ),
      )
      .orderBy(obligationReminders.reminderDate);
  });
}
