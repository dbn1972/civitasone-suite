import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { vigilanceCases, type VigilanceCaseRow } from "./schema.js";

export async function listVigilanceCases(tenantId: string, limit = 50, offset = 0): Promise<VigilanceCaseRow[]> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  return db.transaction((tx) => tx.select().from(vigilanceCases)
    .where(eq(vigilanceCases.tenantId, tenantId))
    .limit(limit)
    .offset(offset));
}

export async function listVigilanceCasesCount(tenantId: string): Promise<number> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select({ count: sql<number>`count(*)::int` }).from(vigilanceCases)
    .where(eq(vigilanceCases.tenantId, tenantId)));
  return rows[0]?.count ?? 0;
}

export async function findVigilanceCaseById(id: string, tenantId: string): Promise<VigilanceCaseRow | null> {
  // Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
  // before this read — a bare db.select() runs with no RLS GUC set.
  const rows = await db.transaction((tx) => tx.select().from(vigilanceCases)
    .where(and(eq(vigilanceCases.id, id), eq(vigilanceCases.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}
