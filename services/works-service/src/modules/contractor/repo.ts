import { eq, and, desc, sql } from "drizzle-orm";
import { scopedRead, db, type ScopedTx } from "../../shared/db.js";
import {
  contractors,
  contractorRatings,
  type ContractorInsert,
  type ContractorRow,
  type ContractorRatingInsert,
  type ContractorRatingRow,
} from "./schema.js";

export async function insertContractor(tx: ScopedTx, row: ContractorInsert): Promise<void> {
  await tx.insert(contractors).values(row);
}

export async function findContractorById(tenantId: string, id: string): Promise<ContractorRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(contractors)
      .where(and(eq(contractors.tenantId, tenantId), eq(contractors.id, id)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listContractors(
  tenantId: string,
  opts?: { limit?: number; offset?: number },
): Promise<ContractorRow[]> {
  return scopedRead((tx) =>
    tx.select().from(contractors)
      .where(and(eq(contractors.tenantId, tenantId), eq(contractors.active, true)))
      .orderBy(desc(contractors.createdAt))
      .limit(opts?.limit ?? 50)
      .offset(opts?.offset ?? 0),
  );
}

export async function updateContractorRating(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  newRating: number,
): Promise<void> {
  // incremental average: new_avg = (old_avg * n + rating) / (n + 1)
  await tx
    .update(contractors)
    .set({
      performanceRating: sql`
        case when rating_count = 0 then ${newRating}
             else cast(round((performance_rating * rating_count + ${newRating})::numeric / (rating_count + 1)) as int)
        end`,
      ratingCount: sql`rating_count + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(contractors.id, id), eq(contractors.tenantId, tenantId)));
}

export async function insertRatingHistory(
  tx: ScopedTx,
  row: Omit<ContractorRatingInsert, "id">,
): Promise<void> {
  await tx.insert(contractorRatings).values(row);
}

export async function listRatingHistory(
  tenantId: string,
  contractorId: string,
  limit = 50,
): Promise<ContractorRatingRow[]> {
  return scopedRead((tx) =>
    tx.select().from(contractorRatings)
      .where(
        and(
          eq(contractorRatings.tenantId, tenantId),
          eq(contractorRatings.contractorId, contractorId),
        )
      )
      .orderBy(desc(contractorRatings.ratedAt))
      .limit(limit),
  );
}

export async function updateContractor(
  tenantId: string,
  id: string,
  patch: Partial<ContractorInsert>,
  updatedBy: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(contractors)
      .set({ ...patch, updatedAt: new Date(), updatedBy })
      .where(and(eq(contractors.id, id), eq(contractors.tenantId, tenantId)));
  });
}
