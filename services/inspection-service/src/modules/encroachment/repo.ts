/**
 * inspection-service: Encroachment module — data access (repository).
 *
 * Read-through via `cache.getOrLoad` for single-entity lookups.
 * All queries are scoped by tenant_id for RLS-compatible isolation.
 *
 * _Requirements: BRD 5.19 ENCR-001..004_
 */
import { eq, and, sql, desc } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import {
  encroachmentComplaints,
  encroachmentNotices,
  encroachmentHearings,
  encroachmentRemovals,
  type EncroachmentComplaintRow,
  type EncroachmentComplaintInsert,
  type EncroachmentNoticeRow,
  type EncroachmentNoticeInsert,
  type EncroachmentHearingRow,
  type EncroachmentHearingInsert,
  type EncroachmentRemovalRow,
  type EncroachmentRemovalInsert,
} from "./schema.js";
import { formatComplaintNumber, formatNoticeNumber } from "./domain.js";

// ── Type Aliases ──────────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface PaginationInput {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

// ── Complaint Reads ───────────────────────────────────────────────────────────

export async function findComplaintById(
  tenantId: string,
  id: string,
): Promise<EncroachmentComplaintRow | null> {
  return cache.getOrLoad<EncroachmentComplaintRow>(
    cache.makeKey(tenantId, "encroachment_complaint", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(encroachmentComplaints)
          .where(and(
            eq(encroachmentComplaints.id, id),
            eq(encroachmentComplaints.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

export async function findComplaints(
  tenantId: string,
  pagination: PaginationInput,
  filters?: { status?: string | undefined },
): Promise<PaginatedResult<EncroachmentComplaintRow>> {
  return scopedRead(async (tx) => {
    const conditions = [eq(encroachmentComplaints.tenantId, tenantId)];
    if (filters?.status) {
      conditions.push(eq(encroachmentComplaints.status, filters.status));
    }
    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(encroachmentComplaints)
        .where(whereClause),
      tx.select().from(encroachmentComplaints)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(encroachmentComplaints.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, total } };
  });
}

// ── Complaint Writes ──────────────────────────────────────────────────────────

/**
 * Issue the next complaint number from encroachment.complaint_number_seq.
 * Replaces the old in-process `let complaintSeq` counter (domain.ts) that
 * reset on every restart and was shared globally across all tenants with
 * no DB-level uniqueness check -- see migration
 * 0028_encroachment_illegal_construction_number_sequences.sql.
 */
export async function nextComplaintNumber(tx: Tx): Promise<string> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"encroachment"."complaint_number_seq"')::bigint AS seq`,
  )) as Array<{ seq: number }>;
  return formatComplaintNumber(Number(row!.seq));
}

export async function insertComplaint(
  tx: Tx,
  data: EncroachmentComplaintInsert,
): Promise<EncroachmentComplaintRow> {
  const rows = await tx.insert(encroachmentComplaints).values(data).returning();
  return rows[0]!;
}

export async function updateComplaint(
  tx: Tx,
  id: string,
  tenantId: string,
  data: Partial<Omit<EncroachmentComplaintInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  expectedVersion: number,
): Promise<EncroachmentComplaintRow> {
  const rows = await tx.update(encroachmentComplaints)
    .set({
      ...data,
      updatedAt: new Date(),
      version: sql`${encroachmentComplaints.version} + 1`,
    })
    .where(and(
      eq(encroachmentComplaints.id, id),
      eq(encroachmentComplaints.tenantId, tenantId),
      eq(encroachmentComplaints.version, expectedVersion),
    ))
    .returning();

  if (rows.length === 0) {
    throw new Error(`Encroachment complaint ${id} not found or version conflict`);
  }
  return rows[0]!;
}

// ── Notice Reads ──────────────────────────────────────────────────────────────

export async function findNoticeById(
  tenantId: string,
  id: string,
): Promise<EncroachmentNoticeRow | null> {
  return cache.getOrLoad<EncroachmentNoticeRow>(
    cache.makeKey(tenantId, "encroachment_notice", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(encroachmentNotices)
          .where(and(
            eq(encroachmentNotices.id, id),
            eq(encroachmentNotices.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

export async function findNotices(
  tenantId: string,
  pagination: PaginationInput,
  filters?: { complaintId?: string | undefined; status?: string | undefined },
): Promise<PaginatedResult<EncroachmentNoticeRow>> {
  return scopedRead(async (tx) => {
    const conditions = [eq(encroachmentNotices.tenantId, tenantId)];
    if (filters?.complaintId) {
      conditions.push(eq(encroachmentNotices.complaintId, filters.complaintId));
    }
    if (filters?.status) {
      conditions.push(eq(encroachmentNotices.status, filters.status));
    }
    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(encroachmentNotices)
        .where(whereClause),
      tx.select().from(encroachmentNotices)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(encroachmentNotices.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, total } };
  });
}

// ── Notice Writes ─────────────────────────────────────────────────────────────

/**
 * Issue the next notice number from encroachment.notice_number_seq.
 * See nextComplaintNumber's note above -- same fix, same reasoning.
 */
export async function nextNoticeNumber(tx: Tx): Promise<string> {
  const [row] = (await tx.execute(
    sql`SELECT nextval('"encroachment"."notice_number_seq"')::bigint AS seq`,
  )) as Array<{ seq: number }>;
  return formatNoticeNumber(Number(row!.seq));
}

export async function insertNotice(
  tx: Tx,
  data: EncroachmentNoticeInsert,
): Promise<EncroachmentNoticeRow> {
  const rows = await tx.insert(encroachmentNotices).values(data).returning();
  return rows[0]!;
}

export async function updateNotice(
  tx: Tx,
  id: string,
  tenantId: string,
  data: Partial<Omit<EncroachmentNoticeInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  expectedVersion: number,
): Promise<EncroachmentNoticeRow> {
  const rows = await tx.update(encroachmentNotices)
    .set({
      ...data,
      updatedAt: new Date(),
      version: sql`${encroachmentNotices.version} + 1`,
    })
    .where(and(
      eq(encroachmentNotices.id, id),
      eq(encroachmentNotices.tenantId, tenantId),
      eq(encroachmentNotices.version, expectedVersion),
    ))
    .returning();

  if (rows.length === 0) {
    throw new Error(`Encroachment notice ${id} not found or version conflict`);
  }
  return rows[0]!;
}

// ── Hearing Reads ─────────────────────────────────────────────────────────────

export async function findHearingById(
  tenantId: string,
  id: string,
): Promise<EncroachmentHearingRow | null> {
  return cache.getOrLoad<EncroachmentHearingRow>(
    cache.makeKey(tenantId, "encroachment_hearing", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(encroachmentHearings)
          .where(and(
            eq(encroachmentHearings.id, id),
            eq(encroachmentHearings.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

export async function findHearings(
  tenantId: string,
  pagination: PaginationInput,
  filters?: { complaintId?: string | undefined; status?: string | undefined },
): Promise<PaginatedResult<EncroachmentHearingRow>> {
  return scopedRead(async (tx) => {
    const conditions = [eq(encroachmentHearings.tenantId, tenantId)];
    if (filters?.complaintId) {
      conditions.push(eq(encroachmentHearings.complaintId, filters.complaintId));
    }
    if (filters?.status) {
      conditions.push(eq(encroachmentHearings.status, filters.status));
    }
    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(encroachmentHearings)
        .where(whereClause),
      tx.select().from(encroachmentHearings)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(encroachmentHearings.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, total } };
  });
}

// ── Hearing Writes ────────────────────────────────────────────────────────────

export async function insertHearing(
  tx: Tx,
  data: EncroachmentHearingInsert,
): Promise<EncroachmentHearingRow> {
  const rows = await tx.insert(encroachmentHearings).values(data).returning();
  return rows[0]!;
}

export async function updateHearing(
  tx: Tx,
  id: string,
  tenantId: string,
  data: Partial<Omit<EncroachmentHearingInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  expectedVersion: number,
): Promise<EncroachmentHearingRow> {
  const rows = await tx.update(encroachmentHearings)
    .set({
      ...data,
      updatedAt: new Date(),
      version: sql`${encroachmentHearings.version} + 1`,
    })
    .where(and(
      eq(encroachmentHearings.id, id),
      eq(encroachmentHearings.tenantId, tenantId),
      eq(encroachmentHearings.version, expectedVersion),
    ))
    .returning();

  if (rows.length === 0) {
    throw new Error(`Encroachment hearing ${id} not found or version conflict`);
  }
  return rows[0]!;
}

// ── Removal Reads ─────────────────────────────────────────────────────────────

export async function findRemovalById(
  tenantId: string,
  id: string,
): Promise<EncroachmentRemovalRow | null> {
  return cache.getOrLoad<EncroachmentRemovalRow>(
    cache.makeKey(tenantId, "encroachment_removal", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(encroachmentRemovals)
          .where(and(
            eq(encroachmentRemovals.id, id),
            eq(encroachmentRemovals.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

// ── Removal Writes ────────────────────────────────────────────────────────────

export async function insertRemoval(
  tx: Tx,
  data: EncroachmentRemovalInsert,
): Promise<EncroachmentRemovalRow> {
  const rows = await tx.insert(encroachmentRemovals).values(data).returning();
  return rows[0]!;
}

export async function updateRemoval(
  tx: Tx,
  id: string,
  tenantId: string,
  data: Partial<Omit<EncroachmentRemovalInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  expectedVersion: number,
): Promise<EncroachmentRemovalRow> {
  const rows = await tx.update(encroachmentRemovals)
    .set({
      ...data,
      updatedAt: new Date(),
      version: sql`${encroachmentRemovals.version} + 1`,
    })
    .where(and(
      eq(encroachmentRemovals.id, id),
      eq(encroachmentRemovals.tenantId, tenantId),
      eq(encroachmentRemovals.version, expectedVersion),
    ))
    .returning();

  if (rows.length === 0) {
    throw new Error(`Encroachment removal ${id} not found or version conflict`);
  }
  return rows[0]!;
}
