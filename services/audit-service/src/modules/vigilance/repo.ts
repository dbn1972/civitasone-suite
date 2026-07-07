import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { vigilanceCases, type VigilanceCaseRow } from "./schema.js";

export async function listVigilanceCases(tenantId: string, limit = 50, offset = 0): Promise<VigilanceCaseRow[]> {
  return db.select().from(vigilanceCases)
    .where(eq(vigilanceCases.tenantId, tenantId))
    .limit(limit)
    .offset(offset);
}

export async function listVigilanceCasesCount(tenantId: string): Promise<number> {
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(vigilanceCases)
    .where(eq(vigilanceCases.tenantId, tenantId));
  return rows[0]?.count ?? 0;
}

export async function findVigilanceCaseById(id: string, tenantId: string): Promise<VigilanceCaseRow | null> {
  const rows = await db.select().from(vigilanceCases)
    .where(and(eq(vigilanceCases.id, id), eq(vigilanceCases.tenantId, tenantId)))
    .limit(1);
  return rows[0] ?? null;
}
