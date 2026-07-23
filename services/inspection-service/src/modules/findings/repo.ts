/**
 * inspection-service: findings module — data access (repository).
 *
 * Read-through via `cache.getOrLoad` for single-entity lookups.
 * All queries are scoped by tenant_id for RLS-compatible isolation.
 * Writes use Drizzle ORM within transaction contexts passed from the consumer.
 *
 * Cache key pattern: `inspection:{tenantId}:finding:{id}`
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_
 */
import { eq, and, isNull, sql, desc, lte } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  findings,
  complianceNotices,
  findingSequences,
  type FindingRow,
  type FindingInsert,
  type ComplianceNoticeRow,
  type ComplianceNoticeInsert,
} from "./schema.js";

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

// ── Finding Reads ─────────────────────────────────────────────────────────────

/**
 * Find a finding by ID with cache read-through.
 * Returns null if not found or soft-deleted.
 */
export async function findFindingById(
  tenantId: string,
  id: string,
): Promise<FindingRow | null> {
  return cache.getOrLoad<FindingRow>(
    cache.makeKey(tenantId, "finding", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(findings)
          .where(and(
            eq(findings.id, id),
            eq(findings.tenantId, tenantId),
            isNull(findings.deletedAt),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * List findings for a tenant with optional inspectionId filter.
 * Excludes soft-deleted findings.
 */
export async function findFindings(
  tenantId: string,
  pagination: PaginationInput,
  filters?: { inspectionId?: string | undefined; state?: string | undefined; severity?: string | undefined },
): Promise<PaginatedResult<FindingRow>> {
  return scopedRead(async (tx) => {
    const conditions = [
      eq(findings.tenantId, tenantId),
      isNull(findings.deletedAt),
    ];

    if (filters?.inspectionId) {
      conditions.push(eq(findings.inspectionId, filters.inspectionId));
    }
    if (filters?.state) {
      conditions.push(eq(findings.state, filters.state));
    }
    if (filters?.severity) {
      conditions.push(eq(findings.severity, filters.severity));
    }

    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(findings)
        .where(whereClause),
      tx.select().from(findings)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(findings.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

// ── Finding Writes (within transaction) ───────────────────────────────────────

/**
 * Insert a new finding within a transaction.
 */
export async function insertFinding(
  tx: Tx,
  data: FindingInsert,
): Promise<FindingRow> {
  const rows = await tx.insert(findings).values(data).returning();
  return rows[0]!;
}

/**
 * Update finding state within a transaction.
 */
export async function updateFindingState(
  tx: Tx,
  id: string,
  tenantId: string,
  newState: string,
  actorId: string,
  additionalFields?: Partial<Pick<FindingRow, "closedAt" | "closedBy" | "verificationEvidence">>,
): Promise<FindingRow> {
  const rows = await tx.update(findings)
    .set({
      state: newState,
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${findings.version} + 1`,
      ...additionalFields,
    })
    .where(and(
      eq(findings.id, id),
      eq(findings.tenantId, tenantId),
      isNull(findings.deletedAt),
    ))
    .returning();

  if (rows.length === 0) {
    throw new HttpError(404, "NOT_FOUND", `finding ${id} not found or has been deleted`);
  }

  return rows[0]!;
}

/**
 * Soft-delete a finding by setting deletedAt timestamp.
 */
export async function softDeleteFinding(
  tx: Tx,
  id: string,
  tenantId: string,
  actorId: string,
): Promise<FindingRow> {
  const rows = await tx.update(findings)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: actorId,
      version: sql`${findings.version} + 1`,
    })
    .where(and(
      eq(findings.id, id),
      eq(findings.tenantId, tenantId),
      isNull(findings.deletedAt),
    ))
    .returning();

  if (rows.length === 0) {
    throw new HttpError(404, "NOT_FOUND", `finding ${id} not found or already deleted`);
  }

  return rows[0]!;
}

// ── Compliance Notice Reads ───────────────────────────────────────────────────

/**
 * Find compliance notices for a specific finding.
 */
export async function findNoticesByFinding(
  tenantId: string,
  findingId: string,
): Promise<ComplianceNoticeRow[]> {
  return scopedRead((tx) =>
    tx.select().from(complianceNotices)
      .where(and(
        eq(complianceNotices.findingId, findingId),
        eq(complianceNotices.tenantId, tenantId),
      ))
      .orderBy(desc(complianceNotices.issuedAt)),
  );
}

// ── Compliance Notice Writes ──────────────────────────────────────────────────

/**
 * Insert a new compliance notice within a transaction.
 */
export async function insertComplianceNotice(
  tx: Tx,
  data: ComplianceNoticeInsert,
): Promise<ComplianceNoticeRow> {
  const rows = await tx.insert(complianceNotices).values(data).returning();
  return rows[0]!;
}

// ── Finding Sequence (atomic number generation) ───────────────────────────────

/**
 * Get the next finding sequence number atomically.
 * Uses INSERT ON CONFLICT UPDATE to atomically increment the sequence.
 * Returns the next sequence value (1-based).
 *
 * _Validates: Requirement 9.3_
 */
export async function nextFindingSequence(
  tx: Tx,
  tenantId: string,
  year: number,
): Promise<number> {
  // Atomically insert or increment the sequence counter
  const rows = await tx.insert(findingSequences)
    .values({
      tenantId,
      year,
      lastSeq: 1,
      version: 1,
    })
    .onConflictDoUpdate({
      target: [findingSequences.tenantId, findingSequences.year],
      set: {
        lastSeq: sql`${findingSequences.lastSeq} + 1`,
        version: sql`${findingSequences.version} + 1`,
      },
    })
    .returning();

  return rows[0]!.lastSeq;
}

// ── Overdue Detection ─────────────────────────────────────────────────────────

/**
 * Find all findings in notice_issued state with compliance notices whose due date
 * has passed. Used by the overdue detection job.
 *
 * _Validates: Requirement 9.5_
 */
export async function findOverdueFindings(
  tenantId: string,
): Promise<FindingRow[]> {
  const today = new Date().toISOString().split("T")[0]!;
  return scopedRead(async (tx) => {
    // Find findings that have a compliance notice with a past due date
    // and are still in notice_issued state (not yet closed or already overdue)
    const overdueNoticeRows = await tx.select({ findingId: complianceNotices.findingId })
      .from(complianceNotices)
      .where(and(
        eq(complianceNotices.tenantId, tenantId),
        lte(complianceNotices.dueDate, today),
      ));

    if (overdueNoticeRows.length === 0) return [];

    const findingIds = overdueNoticeRows.map((r) => r.findingId);

    // Load findings that are still in notice_issued (eligible for overdue transition)
    const rows = await tx.select().from(findings)
      .where(and(
        eq(findings.tenantId, tenantId),
        eq(findings.state, "notice_issued"),
        isNull(findings.deletedAt),
        sql`${findings.id} = ANY(${findingIds})`,
      ));

    return rows;
  });
}
