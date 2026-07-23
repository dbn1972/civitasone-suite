/**
 * inspection-service: universe module — data access (repository).
 *
 * Read-through via `cache.getOrLoad` for single-entity lookups.
 * All queries are scoped by tenant_id for RLS-compatible isolation.
 * Writes use Drizzle ORM within transaction contexts passed from the consumer.
 *
 * Cache key pattern: `inspection:{tenantId}:{resource}:{id}`
 *
 * _Requirements: 2.1, 2.2, 2.7, 2.8_
 */
import { eq, and, isNull, sql } from "drizzle-orm";
import { cache } from "../../shared/infra.js";
import { scopedRead, type Db } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  regulatedEntities,
  inspectionTypes,
  provisions,
  vocabularies,
  type RegulatedEntityRow,
  type RegulatedEntityInsert,
  type InspectionTypeRow,
  type InspectionTypeInsert,
  type ProvisionRow,
  type ProvisionInsert,
  type VocabularyRow,
  type VocabularyInsert,
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

export interface EntityFilters {
  entityType?: string;
  riskCategory?: string;
  jurisdiction?: string;
  city?: string;
  state?: string;
}

// ── Regulated Entities ────────────────────────────────────────────────────────

/**
 * Find a regulated entity by ID with cache read-through.
 * Falls through to DB on cache miss/failure and logs WARN (handled by cache lib).
 */
export async function findEntityById(
  tenantId: string,
  id: string,
): Promise<RegulatedEntityRow | null> {
  return cache.getOrLoad<RegulatedEntityRow>(
    cache.makeKey(tenantId, "entity", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(regulatedEntities)
          .where(and(
            eq(regulatedEntities.id, id),
            eq(regulatedEntities.tenantId, tenantId),
            isNull(regulatedEntities.deletedAt),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

/**
 * Paginated list of entities for a tenant with optional filters.
 * List queries go directly to Postgres (not cached individually).
 */
export async function findEntitiesByTenant(
  tenantId: string,
  filters: EntityFilters,
  pagination: PaginationInput,
): Promise<PaginatedResult<RegulatedEntityRow>> {
  return scopedRead(async (tx) => {
    const conditions = [
      eq(regulatedEntities.tenantId, tenantId),
      isNull(regulatedEntities.deletedAt),
    ];

    if (filters.entityType) {
      conditions.push(eq(regulatedEntities.entityType, filters.entityType));
    }
    if (filters.riskCategory) {
      conditions.push(eq(regulatedEntities.riskCategory, filters.riskCategory));
    }
    if (filters.jurisdiction) {
      conditions.push(eq(regulatedEntities.jurisdiction, filters.jurisdiction));
    }
    if (filters.city) {
      conditions.push(eq(regulatedEntities.city, filters.city));
    }
    if (filters.state) {
      conditions.push(eq(regulatedEntities.state, filters.state));
    }

    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(regulatedEntities)
        .where(whereClause),
      tx.select().from(regulatedEntities)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(regulatedEntities.createdAt),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

/**
 * Insert a new regulated entity within a transaction.
 */
export async function insertEntity(
  tx: Tx,
  data: RegulatedEntityInsert,
): Promise<RegulatedEntityRow> {
  const rows = await tx.insert(regulatedEntities).values(data).returning();
  return rows[0]!;
}

/**
 * Update a regulated entity with optimistic locking.
 * Throws 409 Conflict if the version does not match.
 */
export async function updateEntity(
  tx: Tx,
  id: string,
  version: number,
  patch: Partial<RegulatedEntityInsert>,
): Promise<RegulatedEntityRow> {
  const rows = await tx.update(regulatedEntities)
    .set({ ...patch, version: version + 1, updatedAt: new Date() })
    .where(and(
      eq(regulatedEntities.id, id),
      eq(regulatedEntities.version, version),
    ))
    .returning();

  if (rows.length === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", `Entity ${id} has been modified by another request (expected version ${version})`);
  }

  return rows[0]!;
}

// ── Inspection Types ──────────────────────────────────────────────────────────

export async function findInspectionTypeById(
  tenantId: string,
  id: string,
): Promise<InspectionTypeRow | null> {
  return cache.getOrLoad<InspectionTypeRow>(
    cache.makeKey(tenantId, "inspection_type", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(inspectionTypes)
          .where(and(
            eq(inspectionTypes.id, id),
            eq(inspectionTypes.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

export async function findInspectionTypesByTenant(
  tenantId: string,
  pagination: PaginationInput,
): Promise<PaginatedResult<InspectionTypeRow>> {
  return scopedRead(async (tx) => {
    const whereClause = eq(inspectionTypes.tenantId, tenantId);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(inspectionTypes)
        .where(whereClause),
      tx.select().from(inspectionTypes)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(inspectionTypes.createdAt),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

export async function insertInspectionType(
  tx: Tx,
  data: InspectionTypeInsert,
): Promise<InspectionTypeRow> {
  const rows = await tx.insert(inspectionTypes).values(data).returning();
  return rows[0]!;
}

// ── Provisions ────────────────────────────────────────────────────────────────

export async function findProvisionById(
  tenantId: string,
  id: string,
): Promise<ProvisionRow | null> {
  return cache.getOrLoad<ProvisionRow>(
    cache.makeKey(tenantId, "provision", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(provisions)
          .where(and(
            eq(provisions.id, id),
            eq(provisions.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

export async function findProvisionsByTenant(
  tenantId: string,
  pagination: PaginationInput,
): Promise<PaginatedResult<ProvisionRow>> {
  return scopedRead(async (tx) => {
    const whereClause = eq(provisions.tenantId, tenantId);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(provisions)
        .where(whereClause),
      tx.select().from(provisions)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(provisions.createdAt),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

export async function insertProvision(
  tx: Tx,
  data: ProvisionInsert,
): Promise<ProvisionRow> {
  const rows = await tx.insert(provisions).values(data).returning();
  return rows[0]!;
}

// ── Vocabularies ──────────────────────────────────────────────────────────────

export async function findVocabularyById(
  tenantId: string,
  id: string,
): Promise<VocabularyRow | null> {
  return cache.getOrLoad<VocabularyRow>(
    cache.makeKey(tenantId, "vocabulary", id),
    async () => {
      const rows = await scopedRead((tx) =>
        tx.select().from(vocabularies)
          .where(and(
            eq(vocabularies.id, id),
            eq(vocabularies.tenantId, tenantId),
          )),
      );
      return rows[0] ?? null;
    },
  );
}

export async function findVocabulariesByTenant(
  tenantId: string,
  category: string | undefined,
  pagination: PaginationInput,
): Promise<PaginatedResult<VocabularyRow>> {
  return scopedRead(async (tx) => {
    const conditions = [eq(vocabularies.tenantId, tenantId)];

    if (category) {
      conditions.push(eq(vocabularies.category, category));
    }

    const whereClause = and(...conditions);

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(vocabularies)
        .where(whereClause),
      tx.select().from(vocabularies)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(vocabularies.sortOrder),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

export async function insertVocabulary(
  tx: Tx,
  data: VocabularyInsert,
): Promise<VocabularyRow> {
  const rows = await tx.insert(vocabularies).values(data).returning();
  return rows[0]!;
}

/**
 * Upsert vocabulary by (tenantId, category, code). Inserts if not found,
 * updates label/sortOrder/isActive if exists.
 */
export async function upsertVocabulary(
  tx: Tx,
  data: VocabularyInsert,
): Promise<VocabularyRow> {
  const rows = await tx.insert(vocabularies)
    .values(data)
    .onConflictDoUpdate({
      target: [vocabularies.tenantId, vocabularies.category, vocabularies.code],
      set: {
        label: data.label,
        sortOrder: data.sortOrder ?? 0,
        updatedAt: new Date(),
        updatedBy: data.updatedBy,
        version: sql`${vocabularies.version} + 1`,
      },
    })
    .returning();
  return rows[0]!;
}
