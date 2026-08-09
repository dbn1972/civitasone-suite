/**
 * Sanitation (BRD 5.13) — repository (data access).
 *
 * Reads wrap in db.transaction() so createTenantDb's wrapWithTenantGuc injects
 * app.tenant_id from AsyncLocalStorage before the query.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  sanitationComplaints,
  sanitationFieldActions,
  type ComplaintRow,
  type ComplaintInsert,
  type FieldActionRow,
  type FieldActionInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

// ── Complaints ────────────────────────────────────────────────────────────────

export async function insertComplaint(tx: Writer, row: ComplaintInsert): Promise<ComplaintRow> {
  const res = await (tx as typeof db).insert(sanitationComplaints).values(row).returning();
  return res[0]!;
}

export async function findComplaint(id: string, tenantId: string): Promise<ComplaintRow | null> {
  const rows = await db.transaction((tx) =>
    tx
      .select()
      .from(sanitationComplaints)
      .where(and(eq(sanitationComplaints.id, id), eq(sanitationComplaints.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listComplaints(
  tenantId: string,
  opts: {
    status?: string | undefined;
    complaintType?: string | undefined;
    severity?: string | undefined;
    limit: number;
    offset: number;
  },
): Promise<ComplaintRow[]> {
  return db.transaction((tx) => {
    const conds = [eq(sanitationComplaints.tenantId, tenantId)];
    if (opts.status) conds.push(eq(sanitationComplaints.status, opts.status));
    if (opts.complaintType) conds.push(eq(sanitationComplaints.complaintType, opts.complaintType));
    if (opts.severity) conds.push(eq(sanitationComplaints.severity, opts.severity));
    return tx
      .select()
      .from(sanitationComplaints)
      .where(and(...conds))
      .orderBy(desc(sanitationComplaints.createdAt))
      .limit(opts.limit)
      .offset(opts.offset);
  });
}

export async function updateComplaint(
  tx: Writer,
  id: string,
  tenantId: string,
  patch: Partial<ComplaintInsert>,
): Promise<ComplaintRow | null> {
  const res = await (tx as typeof db)
    .update(sanitationComplaints)
    .set({ ...patch, updatedAt: new Date(), version: sql`${sanitationComplaints.version} + 1` })
    .where(and(eq(sanitationComplaints.id, id), eq(sanitationComplaints.tenantId, tenantId)))
    .returning();
  return res[0] ?? null;
}

// ── Field actions ─────────────────────────────────────────────────────────────

export async function insertFieldAction(tx: Writer, row: FieldActionInsert): Promise<FieldActionRow> {
  const res = await (tx as typeof db).insert(sanitationFieldActions).values(row).returning();
  return res[0]!;
}

export async function listFieldActions(
  tenantId: string,
  opts: {
    complaintId?: string | undefined;
    limit: number;
    offset: number;
  },
): Promise<FieldActionRow[]> {
  return db.transaction((tx) => {
    const conds = [eq(sanitationFieldActions.tenantId, tenantId)];
    if (opts.complaintId) conds.push(eq(sanitationFieldActions.complaintId, opts.complaintId));
    return tx
      .select()
      .from(sanitationFieldActions)
      .where(and(...conds))
      .orderBy(desc(sanitationFieldActions.performedAt))
      .limit(opts.limit)
      .offset(opts.offset);
  });
}
