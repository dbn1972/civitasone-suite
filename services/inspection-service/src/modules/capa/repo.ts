/**
 * inspection-service: CAPA module — data access (repository).
 *
 * Read-through via `cache.getOrLoad` for single-entity lookups.
 * All queries are scoped by tenant_id for RLS-compatible isolation.
 * Writes use Drizzle ORM within transaction contexts passed from the consumer.
 *
 * Cache key pattern: `inspection:{tenantId}:capa:{id}`
 *
 * _Requirements: SVC-106_
 */
import { eq, and, sql, desc } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import {
  correctiveActions,
  type CorrectiveActionRow,
  type CorrectiveActionInsert,
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

// ── CAPA Reads ────────────────────────────────────────────────────────────────

/**
 * Find a CAPA by ID with cache read-through.
 */
export async function findCapaById(
  tenantId: string,
  id: string,
): Promise<CorrectiveActionRow | null> {
  return cache.getOrLoad<CorrectiveActionRow>(
    cache.makeKey(tenantId, "capa", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(correctiveActions)
          .where(and(
            eq(correctiveActions.id, id),
            eq(correctiveActions.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * List CAPAs for a tenant with optional filters.
 */
export async function findCapas(
  tenantId: string,
  pagination: PaginationInput,
  filters?: {
    findingId?: string | undefined;
    status?: string | undefined;
    ownerId?: string | undefined;
    overdue?: boolean | undefined;
  },
): Promise<PaginatedResult<CorrectiveActionRow>> {
  return scopedRead(async (tx) => {
    const conditions = [eq(correctiveActions.tenantId, tenantId)];

    if (filters?.findingId) {
      conditions.push(eq(correctiveActions.findingId, filters.findingId));
    }
    if (filters?.status) {
      conditions.push(eq(correctiveActions.status, filters.status));
    }
    if (filters?.ownerId) {
      conditions.push(eq(correctiveActions.ownerId, filters.ownerId));
    }
    if (filters?.overdue) {
      conditions.push(eq(correctiveActions.status, "overdue"));
    }

    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(correctiveActions)
        .where(whereClause),
      tx.select().from(correctiveActions)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(correctiveActions.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

// ── CAPA Writes (within transaction) ──────────────────────────────────────────

/**
 * Insert a new CAPA within a transaction.
 */
export async function insertCapa(
  tx: Tx,
  data: CorrectiveActionInsert,
): Promise<CorrectiveActionRow> {
  const rows = await tx.insert(correctiveActions).values(data).returning();
  return rows[0]!;
}

/**
 * Update a CAPA within a transaction with optimistic locking.
 */
export async function updateCapa(
  tx: Tx,
  id: string,
  tenantId: string,
  data: Partial<Omit<CorrectiveActionInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  expectedVersion: number,
): Promise<CorrectiveActionRow> {
  const rows = await tx.update(correctiveActions)
    .set({
      ...data,
      updatedAt: new Date(),
      version: sql`${correctiveActions.version} + 1`,
    })
    .where(and(
      eq(correctiveActions.id, id),
      eq(correctiveActions.tenantId, tenantId),
      eq(correctiveActions.version, expectedVersion),
    ))
    .returning();

  if (rows.length === 0) {
    throw new Error(`CAPA ${id} not found or version conflict (expected version ${expectedVersion})`);
  }

  return rows[0]!;
}
