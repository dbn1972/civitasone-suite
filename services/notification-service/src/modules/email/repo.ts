/**
 * CR-MKT-04 — sending-domain reads/writes.
 */
import { eq, and, desc, sql } from "drizzle-orm";
import { db, readScoped } from "../../shared/db.js";
import {
  sendingDomains,
  domainAuthChecks,
  type SendingDomainInsert,
  type DomainAuthCheckInsert,
  type SendingDomainRow,
  type DomainAuthCheckRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertSendingDomain(tx: Writer, row: SendingDomainInsert): Promise<void> {
  await tx.insert(sendingDomains).values(row);
}

export async function insertAuthCheck(tx: Writer, row: DomainAuthCheckInsert): Promise<void> {
  await tx.insert(domainAuthChecks).values(row);
}

export async function findDomainInTx(
  tx: Writer, tenantId: string, id: string,
): Promise<SendingDomainRow | null> {
  const rows = await tx.select().from(sendingDomains)
    .where(and(eq(sendingDomains.tenantId, tenantId), eq(sendingDomains.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/** Roll the newest check result up onto the domain row (health + lastCheckedAt). */
export async function applyHealth(
  tx: Writer, tenantId: string, id: string, health: string, checkedAt: Date,
  actorId: string, currentVersion: number,
): Promise<void> {
  await tx.update(sendingDomains).set({
    health, lastCheckedAt: checkedAt, updatedAt: new Date(),
    updatedBy: actorId, version: currentVersion + 1,
  }).where(and(eq(sendingDomains.tenantId, tenantId), eq(sendingDomains.id, id)));
}

export async function findDomainById(
  tenantId: string, id: string,
): Promise<SendingDomainRow | null> {
  const rows = await readScoped(tenantId, (tx) => tx.select().from(sendingDomains)
    .where(and(eq(sendingDomains.tenantId, tenantId), eq(sendingDomains.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function listDomains(
  tenantId: string, limit: number, offset: number,
): Promise<{ rows: SendingDomainRow[]; total: number }> {
  return readScoped(tenantId, async (tx) => {
    const rows = await tx.select().from(sendingDomains)
      .where(eq(sendingDomains.tenantId, tenantId))
      .orderBy(desc(sendingDomains.createdAt))
      .limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` })
      .from(sendingDomains).where(eq(sendingDomains.tenantId, tenantId));
    return { rows, total: counted[0]?.n ?? 0 };
  });
}

export async function listChecks(
  tenantId: string, sendingDomainId: string, limit: number,
): Promise<DomainAuthCheckRow[]> {
  return readScoped(tenantId, (tx) => tx.select().from(domainAuthChecks)
    .where(and(
      eq(domainAuthChecks.tenantId, tenantId),
      eq(domainAuthChecks.sendingDomainId, sendingDomainId),
    ))
    .orderBy(desc(domainAuthChecks.checkedAt))
    .limit(limit));
}
