/**
 * inspection-service: evidence module — data access (repository).
 *
 * Read-through via `cache.getOrLoad` for single-entity lookups.
 * All queries are scoped by tenant_id for RLS-compatible isolation.
 * Writes use Drizzle ORM within transaction contexts passed from the consumer.
 *
 * Cache key pattern: `inspection:{tenantId}:evidence:{id}`
 *
 * _Requirements: 7.1, 7.2, 7.4, 7.5_
 */
import { eq, and, sql } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import {
  evidenceArtifacts,
  chainOfCustody,
  type EvidenceArtifactRow,
  type EvidenceArtifactInsert,
  type ChainOfCustodyRow,
  type ChainOfCustodyInsert,
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

// ── Evidence Artifacts ────────────────────────────────────────────────────────

/**
 * Find an evidence artifact by ID with cache read-through.
 */
export async function findEvidenceById(
  tenantId: string,
  id: string,
): Promise<EvidenceArtifactRow | null> {
  return cache.getOrLoad<EvidenceArtifactRow>(
    cache.makeKey(tenantId, "evidence", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(evidenceArtifacts)
          .where(and(
            eq(evidenceArtifacts.id, id),
            eq(evidenceArtifacts.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * Find evidence artifacts by inspection (list query — not cached individually).
 */
export async function findEvidenceByInspection(
  tenantId: string,
  inspectionId: string,
  pagination: PaginationInput,
): Promise<PaginatedResult<EvidenceArtifactRow>> {
  return scopedRead(async (tx) => {
    const whereClause = and(
      eq(evidenceArtifacts.tenantId, tenantId),
      eq(evidenceArtifacts.inspectionId, inspectionId),
    );

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(evidenceArtifacts)
        .where(whereClause),
      tx.select().from(evidenceArtifacts)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(evidenceArtifacts.createdAt),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

/**
 * Insert a new evidence artifact within a transaction.
 */
export async function insertEvidence(
  tx: Tx,
  data: EvidenceArtifactInsert,
): Promise<EvidenceArtifactRow> {
  const rows = await tx.insert(evidenceArtifacts).values(data).returning();
  return rows[0]!;
}

/**
 * Update evidence integrity status (e.g., mark as tampered).
 */
export async function updateEvidenceIntegrity(
  tx: Tx,
  id: string,
  tenantId: string,
  integrityStatus: "valid" | "tampered" | "unverified",
): Promise<EvidenceArtifactRow> {
  const rows = await tx.update(evidenceArtifacts)
    .set({
      integrityStatus,
      updatedAt: new Date(),
      version: sql`${evidenceArtifacts.version} + 1`,
    })
    .where(and(
      eq(evidenceArtifacts.id, id),
      eq(evidenceArtifacts.tenantId, tenantId),
    ))
    .returning();
  return rows[0]!;
}

// ── Chain of Custody ──────────────────────────────────────────────────────────

/**
 * Insert a chain of custody entry within a transaction.
 */
export async function insertCustodyEntry(
  tx: Tx,
  data: ChainOfCustodyInsert,
): Promise<ChainOfCustodyRow> {
  const rows = await tx.insert(chainOfCustody).values(data).returning();
  return rows[0]!;
}

/**
 * Find chain of custody entries for an evidence artifact.
 */
export async function findCustodyByEvidence(
  tenantId: string,
  evidenceId: string,
): Promise<ChainOfCustodyRow[]> {
  return scopedRead((tx) =>
    tx.select().from(chainOfCustody)
      .where(and(
        eq(chainOfCustody.tenantId, tenantId),
        eq(chainOfCustody.evidenceId, evidenceId),
      ))
      .orderBy(chainOfCustody.recordedAt),
  );
}
