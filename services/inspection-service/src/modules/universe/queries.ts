/**
 * inspection-service: universe module — read model / query handlers.
 *
 * Full-text search across name, registration_no, and address fields using
 * PostgreSQL tsvector. Paginated list with standard CivitasOne response envelope.
 *
 * _Requirements: 2.7, 2.8_
 */
import { eq, and, isNull, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { regulatedEntities, type RegulatedEntityRow } from "./schema.js";
import type { PaginationInput, PaginatedResult, EntityFilters } from "./repo.js";

/**
 * Full-text search across regulated entities.
 * Searches name, registration_no, and address (address_line1, city, state) using
 * PostgreSQL's to_tsvector/to_tsquery for proper lexeme matching with websearch syntax.
 *
 * Falls back to ILIKE pattern matching when query is a single short token to
 * handle partial matches that tsquery doesn't support well.
 */
export async function searchEntities(
  tenantId: string,
  query: string,
  pagination: PaginationInput,
): Promise<PaginatedResult<RegulatedEntityRow>> {
  const trimmed = query.trim();

  if (!trimmed) {
    // Empty search returns all entities (paginated)
    return listEntities(tenantId, {}, pagination);
  }

  return scopedRead(async (tx) => {
    // Use websearch_to_tsquery for user-friendly query syntax (handles AND/OR/NOT/phrases)
    const searchCondition = sql`
      to_tsvector('english',
        coalesce(${regulatedEntities.name}, '') || ' ' ||
        coalesce(${regulatedEntities.registrationNo}, '') || ' ' ||
        coalesce(${regulatedEntities.addressLine1}, '') || ' ' ||
        coalesce(${regulatedEntities.city}, '') || ' ' ||
        coalesce(${regulatedEntities.state}, '')
      ) @@ websearch_to_tsquery('english', ${trimmed})
    `;

    // Fallback: also match via ILIKE for partial/prefix queries
    const ilikeCondition = sql`
      (${regulatedEntities.name} ILIKE ${'%' + trimmed + '%'}
       OR ${regulatedEntities.registrationNo} ILIKE ${'%' + trimmed + '%'}
       OR ${regulatedEntities.addressLine1} ILIKE ${'%' + trimmed + '%'}
       OR ${regulatedEntities.city} ILIKE ${'%' + trimmed + '%'}
       OR ${regulatedEntities.state} ILIKE ${'%' + trimmed + '%'})
    `;

    const whereClause = and(
      eq(regulatedEntities.tenantId, tenantId),
      isNull(regulatedEntities.deletedAt),
      sql`(${searchCondition} OR ${ilikeCondition})`,
    );

    const [countResult, data] = await Promise.all([
      tx.select({ count: sql<number>`count(*)::int` })
        .from(regulatedEntities)
        .where(whereClause),
      tx.select().from(regulatedEntities)
        .where(whereClause)
        .limit(pagination.pageSize)
        .offset((pagination.page - 1) * pagination.pageSize)
        .orderBy(regulatedEntities.name),
    ]);

    const total = countResult[0]?.count ?? 0;

    return {
      data,
      meta: { page: pagination.page, pageSize: pagination.pageSize, total },
    };
  });
}

/**
 * Paginated list of entities with optional filters.
 * Standard paginated response: `{ data: T[], meta: { page, pageSize, total } }`.
 */
export async function listEntities(
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
