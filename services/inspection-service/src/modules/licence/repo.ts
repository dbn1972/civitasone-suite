/**
 * inspection-service: Licence module — data access (repository).
 *
 * _Requirements: SVC-108_
 */
import { eq, and, sql, desc, lte, gte } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import {
  licences,
  type LicenceRow,
  type LicenceInsert,
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

// ── Licence Reads ─────────────────────────────────────────────────────────────

export async function findLicenceById(
  tenantId: string,
  id: string,
): Promise<LicenceRow | null> {
  return cache.getOrLoad<LicenceRow>(
    cache.makeKey(tenantId, "licence", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(licences)
          .where(and(
            eq(licences.id, id),
            eq(licences.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

export async function findLicences(
  tenantId: string,
  pagination: PaginationInput,
  filters?: {
    entityId?: string | undefined;
    status?: string | undefined;
  },
): Promise<PaginatedResult<LicenceRow>> {
  return scopedRead(async (tx) => {
    const conditions = [eq(licences.tenantId, tenantId)];

    if (filters?.entityId) {
      conditions.push(eq(licences.entityId, filters.entityId));
    }
    if (filters?.status) {
      conditions.push(eq(licences.status, filters.status));
    }

    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(licences)
        .where(whereClause),
      tx.select().from(licences)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(licences.createdAt)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, total } };
  });
}

export async function findExpiringLicences(
  tenantId: string,
  daysAhead: number,
  pagination: PaginationInput,
): Promise<PaginatedResult<LicenceRow>> {
  return scopedRead(async (tx) => {
    const today = new Date().toISOString().split("T")[0]!;
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);
    const futureDateStr = futureDate.toISOString().split("T")[0]!;

    const whereClause = and(
      eq(licences.tenantId, tenantId),
      eq(licences.status, "active"),
      gte(licences.validTo, today),
      lte(licences.validTo, futureDateStr),
    );

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(licences)
        .where(whereClause),
      tx.select().from(licences)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(desc(licences.validTo)),
    ]);

    const total = countResult[0]?.count ?? 0;
    return { data, meta: { page: pagination.page, pageSize: pagination.pageSize, total } };
  });
}

// ── Licence Writes ────────────────────────────────────────────────────────────

export async function insertLicence(
  tx: Tx,
  data: LicenceInsert,
): Promise<LicenceRow> {
  const rows = await tx.insert(licences).values(data).returning();
  return rows[0]!;
}

export async function updateLicence(
  tx: Tx,
  id: string,
  tenantId: string,
  data: Partial<Omit<LicenceInsert, "id" | "tenantId" | "createdAt" | "createdBy">>,
  expectedVersion: number,
): Promise<LicenceRow> {
  const rows = await tx.update(licences)
    .set({
      ...data,
      updatedAt: new Date(),
      version: sql`${licences.version} + 1`,
    })
    .where(and(
      eq(licences.id, id),
      eq(licences.tenantId, tenantId),
      eq(licences.version, expectedVersion),
    ))
    .returning();

  if (rows.length === 0) {
    throw new Error(`Licence ${id} not found or version conflict (expected ${expectedVersion})`);
  }
  return rows[0]!;
}
