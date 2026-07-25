import { and, eq, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  rtiApplications, rtiTransfers, rtiThirdPartyConsults, rtiExemptions,
  rtiResponses, rtiAppeals, rtiDisclosureLog,
  type RtiApplicationRow, type RtiApplicationInsert, type RtiAppealRow, type RtiAppealInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── applications ──────────────────────────────────────────────────────────
export async function insertApplication(tx: Writer, row: RtiApplicationInsert): Promise<void> {
  await tx.insert(rtiApplications).values(row);
}

export async function findByIdTx(tx: Writer, id: string, tenantId: string): Promise<RtiApplicationRow | null> {
  const rows = await (tx as typeof db).select().from(rtiApplications)
    .where(and(eq(rtiApplications.id, id), eq(rtiApplications.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findById(id: string, tenantId: string): Promise<RtiApplicationRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(rtiApplications)
    .where(and(eq(rtiApplications.id, id), eq(rtiApplications.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function listByTenant(tenantId: string, limit: number): Promise<RtiApplicationRow[]> {
  return db.transaction((tx) => tx.select().from(rtiApplications)
    .where(eq(rtiApplications.tenantId, tenantId))
    .orderBy(desc(rtiApplications.receivedAt))
    .limit(limit));
}

/** Optimistic-locked, tenant-scoped update. Returns rows affected. */
export async function updateApplicationVersioned(
  tx: Writer, id: string, tenantId: string, expectedVersion: number, patch: Partial<RtiApplicationInsert>,
): Promise<number> {
  const res = await (tx as typeof db).update(rtiApplications)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(rtiApplications.id, id), eq(rtiApplications.tenantId, tenantId), eq(rtiApplications.version, expectedVersion)))
    .returning({ id: rtiApplications.id });
  return res.length;
}

// ── transfers / consults / exemptions / responses / disclosure ─────────────
export async function insertTransfer(tx: Writer, row: typeof rtiTransfers.$inferInsert): Promise<void> {
  await tx.insert(rtiTransfers).values(row);
}
export async function insertConsult(tx: Writer, row: typeof rtiThirdPartyConsults.$inferInsert): Promise<void> {
  await tx.insert(rtiThirdPartyConsults).values(row);
}
export async function insertExemption(tx: Writer, row: typeof rtiExemptions.$inferInsert): Promise<void> {
  await tx.insert(rtiExemptions).values(row);
}
export async function insertResponse(tx: Writer, row: typeof rtiResponses.$inferInsert): Promise<void> {
  await tx.insert(rtiResponses).values(row);
}
export async function insertDisclosure(tx: Writer, row: typeof rtiDisclosureLog.$inferInsert): Promise<void> {
  await tx.insert(rtiDisclosureLog).values(row);
}

export async function listDisclosures(tenantId: string, limit: number) {
  return db.transaction((tx) => tx.select().from(rtiDisclosureLog)
    .where(eq(rtiDisclosureLog.tenantId, tenantId))
    .orderBy(desc(rtiDisclosureLog.disclosedAt))
    .limit(limit));
}

// ── appeals ─────────────────────────────────────────────────────────────────
export async function insertAppeal(tx: Writer, row: RtiAppealInsert): Promise<void> {
  await tx.insert(rtiAppeals).values(row);
}

export async function findAppealByIdTx(tx: Writer, id: string, tenantId: string): Promise<RtiAppealRow | null> {
  const rows = await (tx as typeof db).select().from(rtiAppeals)
    .where(and(eq(rtiAppeals.id, id), eq(rtiAppeals.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function listAppealsForApplicationTx(tx: Writer, applicationId: string, tenantId: string): Promise<RtiAppealRow[]> {
  return (tx as typeof db).select().from(rtiAppeals)
    .where(and(eq(rtiAppeals.applicationId, applicationId), eq(rtiAppeals.tenantId, tenantId)));
}

export async function listAppealsForApplication(applicationId: string, tenantId: string): Promise<RtiAppealRow[]> {
  return db.transaction((tx) => tx.select().from(rtiAppeals)
    .where(and(eq(rtiAppeals.applicationId, applicationId), eq(rtiAppeals.tenantId, tenantId)))
    .orderBy(desc(rtiAppeals.filedAt)));
}

export async function updateAppealVersioned(
  tx: Writer, id: string, tenantId: string, expectedVersion: number, patch: Partial<RtiAppealInsert>,
): Promise<number> {
  const res = await (tx as typeof db).update(rtiAppeals)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(rtiAppeals.id, id), eq(rtiAppeals.tenantId, tenantId), eq(rtiAppeals.version, expectedVersion)))
    .returning({ id: rtiAppeals.id });
  return res.length;
}
