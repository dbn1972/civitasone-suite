import { eq, and, asc, inArray } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  citizenRtiRequests, citizenRtiResponses, citizenRtiAppeals, citizenRtiTransfers,
  type RtiRow, type RtiInsert, type RtiResponseInsert, type RtiAppealInsert, type RtiTransferInsert,
} from "./schema.js";
import { cpioDirectory } from "../cpio/schema.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findRtiById(id: string): Promise<RtiRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(citizenRtiRequests).where(eq(citizenRtiRequests.id, id)).limit(1));
  return rows[0] ?? null;
}

/** P1-2: scope by (id AND tenantId) so a forged foreign id cannot be read/mutated. */
export async function findRtiByIdTx(tx: Writer, id: string, tenantId: string): Promise<RtiRow | null> {
  const rows = await (tx as typeof db).select().from(citizenRtiRequests)
    .where(and(eq(citizenRtiRequests.id, id), eq(citizenRtiRequests.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function insertRti(tx: Writer, row: RtiInsert): Promise<void> {
  await tx.insert(citizenRtiRequests).values(row);
}

export async function updateRti(tx: Writer, id: string, tenantId: string, patch: Partial<RtiInsert>): Promise<void> {
  // P1-2: tenant-scoped update prevents cross-tenant writes via a forged id.
  await tx.update(citizenRtiRequests).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(citizenRtiRequests.id, id), eq(citizenRtiRequests.tenantId, tenantId)));
}

export async function insertResponse(tx: Writer, row: RtiResponseInsert): Promise<void> {
  await tx.insert(citizenRtiResponses).values(row);
}

export async function insertAppeal(tx: Writer, row: RtiAppealInsert): Promise<void> {
  await tx.insert(citizenRtiAppeals).values(row);
}

export async function listResponses(rtiId: string) {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(citizenRtiResponses).where(eq(citizenRtiResponses.rtiId, rtiId)));
}

export async function insertTransfer(tx: Writer, row: RtiTransferInsert): Promise<void> {
  await tx.insert(citizenRtiTransfers).values(row);
}

/**
 * GAP-CITIZEN-RTI-DETAIL-06: the s.6(3) transfer trail for one RTI, oldest first.
 * The authority columns hold cpio_directory ids; they are resolved to a directory
 * public-authority name when the id is known, otherwise the raw value is returned.
 */
export async function listTransfers(rtiId: string) {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read -- a bare db.select() runs with no RLS GUC set.
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(citizenRtiTransfers)
      .where(eq(citizenRtiTransfers.rtiId, rtiId))
      .orderBy(asc(citizenRtiTransfers.transferredAt));
    const ids = [...new Set(rows.flatMap((r) => [r.fromAuthority, r.toAuthority]).filter((v) => UUID_RE.test(v)))];
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const dir = await tx.select({ id: cpioDirectory.id, authority: cpioDirectory.publicAuthority })
        .from(cpioDirectory).where(inArray(cpioDirectory.id, ids));
      for (const d of dir) names.set(d.id, d.authority);
    }
    return rows.map((r) => ({
      id: r.id,
      fromAuthority: names.get(r.fromAuthority) ?? r.fromAuthority,
      toAuthority: names.get(r.toAuthority) ?? r.toAuthority,
      transferredAt: r.transferredAt,
    }));
  });
}

export async function listAppeals(rtiId: string) {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(citizenRtiAppeals).where(eq(citizenRtiAppeals.rtiId, rtiId)));
}

export async function listRtiByTenant(tenantId: string, limit: number): Promise<RtiRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(citizenRtiRequests).where(eq(citizenRtiRequests.tenantId, tenantId)).limit(limit));
}

/** P0-1: citizen-scoped RTI list so a citizen only sees their own requests. */
export async function listRtiByCitizen(tenantId: string, citizenId: string, limit: number): Promise<RtiRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(citizenRtiRequests)
    .where(and(eq(citizenRtiRequests.tenantId, tenantId), eq(citizenRtiRequests.citizenId, citizenId)))
    .limit(limit));
}
