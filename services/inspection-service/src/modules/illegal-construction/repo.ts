/**
 * inspection-service: Illegal Construction module — data access (repository).
 *
 * Read-through via `cache.getOrLoad` for single-entity lookups.
 * All queries are scoped by tenant_id for RLS-compatible isolation.
 *
 * _Requirements: BRD 5.20 ILBLD-001..004_
 */
import { eq, and, sql, desc } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import {
  illegalConstructionCases,
  illegalConstructionActions,
  type IllegalConstructionCaseRow,
  type IllegalConstructionCaseInsert,
  type IllegalConstructionActionRow,
  type IllegalConstructionActionInsert,
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

// ── Case Reads ────────────────────────────────────────────────────────────────

export async function findCaseById(
  tenantId: string,
  id: string,
): Promise<IllegalConstructionCaseRow | null> {
  return cache.getOrLoad<IllegalConstructionCaseRow>(
    cache.makeKey(tenantId, "illegal_construction_case", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(illegalConstructionCases)
          .where(and(
            eq(illegalConstructionCases.id, id),
            eq(illegalConstructionCases.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

export async function findCases(
  tenantId: string,
  pagination: PaginationInput,
  filters?: { status?: string | undefined; violationType?: string | undefined },
): Promise<PaginatedResult<IllegalConstructionCaseRow>> {
  return scopedRead(async (tx) => {
    const conditions = [eq(illegalConstructionCases.tenantId, tenantId)];
    if (filters?.status) {
      conditions.push(eq(illegalConstructionCases.status, filters.status));
    }
    if (filters?.violationType) {
      conditions.push(eq(illegalConstructionCases.violationType, filters.violationType));
    }
    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(illegalConstructionCases)
        .where(whereClause),
      tx.select().from(illegalConstructionCases)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(illegalConstructionCases.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, total } };
  });
}

// ── Case Writes ───────────────────────────────────────────────────────────────

export async function insertCase(
  tx: Tx,
  data: IllegalConstructionCaseInsert,
): Promise<IllegalConstructionCaseRow> {
  const rows = await tx.insert(illegalConstructionCases).values(data).returning();
  return rows[0]!;
}

export async function updateCase(
  tx: Tx,
  id: string,
  tenantId: string,
  data: Partial<Omit<IllegalConstructionCaseInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  expectedVersion: number,
): Promise<IllegalConstructionCaseRow> {
  const rows = await tx.update(illegalConstructionCases)
    .set({
      ...data,
      updatedAt: new Date(),
      version: sql`${illegalConstructionCases.version} + 1`,
    })
    .where(and(
      eq(illegalConstructionCases.id, id),
      eq(illegalConstructionCases.tenantId, tenantId),
      eq(illegalConstructionCases.version, expectedVersion),
    ))
    .returning();

  if (rows.length === 0) {
    throw new Error(`Illegal construction case ${id} not found or version conflict`);
  }
  return rows[0]!;
}

// ── Action Reads ──────────────────────────────────────────────────────────────

export async function findActionById(
  tenantId: string,
  id: string,
): Promise<IllegalConstructionActionRow | null> {
  return cache.getOrLoad<IllegalConstructionActionRow>(
    cache.makeKey(tenantId, "illegal_construction_action", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(illegalConstructionActions)
          .where(and(
            eq(illegalConstructionActions.id, id),
            eq(illegalConstructionActions.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

export async function findActionsByCaseId(
  tenantId: string,
  caseId: string,
  pagination: PaginationInput,
): Promise<PaginatedResult<IllegalConstructionActionRow>> {
  return scopedRead(async (tx) => {
    const whereClause = and(
      eq(illegalConstructionActions.tenantId, tenantId),
      eq(illegalConstructionActions.caseId, caseId),
    );

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(illegalConstructionActions)
        .where(whereClause),
      tx.select().from(illegalConstructionActions)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(illegalConstructionActions.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, total } };
  });
}

// ── Action Writes ─────────────────────────────────────────────────────────────

export async function insertAction(
  tx: Tx,
  data: IllegalConstructionActionInsert,
): Promise<IllegalConstructionActionRow> {
  const rows = await tx.insert(illegalConstructionActions).values(data).returning();
  return rows[0]!;
}

export async function updateAction(
  tx: Tx,
  id: string,
  tenantId: string,
  data: Partial<Omit<IllegalConstructionActionInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  expectedVersion: number,
): Promise<IllegalConstructionActionRow> {
  const rows = await tx.update(illegalConstructionActions)
    .set({
      ...data,
      updatedAt: new Date(),
      version: sql`${illegalConstructionActions.version} + 1`,
    })
    .where(and(
      eq(illegalConstructionActions.id, id),
      eq(illegalConstructionActions.tenantId, tenantId),
      eq(illegalConstructionActions.version, expectedVersion),
    ))
    .returning();

  if (rows.length === 0) {
    throw new Error(`Illegal construction action ${id} not found or version conflict`);
  }
  return rows[0]!;
}
