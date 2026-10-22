import { eq, and, desc, sql, count, getTableColumns } from "drizzle-orm";
import { scopedRead, db, type ScopedTx } from "../../shared/db.js";
import { workProposals } from "../proposal/schema.js";
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

/**
 * Bug fix (works-billing-integrity #4): case-insensitive exact-name lookup,
 * used to validate an award's free-text contractorName against a real,
 * registered contractor record when the caller doesn't supply contractorId.
 */
export async function findContractorByName(tenantId: string, name: string): Promise<ContractorRow | null> {
  const trimmed = name.trim();
  // Exact case-insensitive match (not a LIKE pattern — a contractor name
  // containing "%" or "_" must not be treated as a wildcard).
  const rows = await scopedRead((tx) =>
    tx.select().from(contractors)
      .where(and(eq(contractors.tenantId, tenantId), sql`lower(${contractors.name}) = lower(${trimmed})`))
      .limit(1),
  );
  return rows[0] ?? null;
}

/**
 * GAP-WORKS-CONTRACTORS-NEW-05: contractor registration numbers are unique per tenant (case-insensitive, trimmed).
 * `excludeId` lets an update keep its own number.
 */
function registrationNoMatch(tenantId: string, registrationNo: string, excludeId?: string) {
  return and(
    eq(contractors.tenantId, tenantId),
    sql`lower(${contractors.registrationNo}) = lower(${registrationNo.trim()})`,
    ...(excludeId ? [sql`${contractors.id} <> ${excludeId}`] : []),
  );
}

export async function findContractorByRegistrationNo(
  tenantId: string,
  registrationNo: string,
  excludeId?: string,
): Promise<ContractorRow | null> {
  if (registrationNo.trim() === "") return null;
  const rows = await scopedRead((tx) =>
    tx.select().from(contractors).where(registrationNoMatch(tenantId, registrationNo, excludeId)).limit(1),
  );
  return rows[0] ?? null;
}

/** Same lookup inside the caller's transaction (consumers re-assert uniqueness where they write). */
export async function findContractorByRegistrationNoTx(
  tx: ScopedTx,
  tenantId: string,
  registrationNo: string,
  excludeId?: string,
): Promise<ContractorRow | null> {
  if (registrationNo.trim() === "") return null;
  const rows = await tx.select().from(contractors).where(registrationNoMatch(tenantId, registrationNo, excludeId)).limit(1);
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

/** GAP-WORKS-CONTRACTORS-03: the true size of the active register, so the list can report "N of total". */
export async function countContractors(tenantId: string): Promise<number> {
  return scopedRead(async (tx) => {
    const rows = await tx.select({ value: count() }).from(contractors)
      .where(and(eq(contractors.tenantId, tenantId), eq(contractors.active, true)));
    return Number(rows[0]?.value ?? 0);
  });
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

/**
 * GAP-WORKS-CONTRACTORS-DETAIL-04: take the contractor row lock for the rest of the caller's transaction. Concurrent
 * rate commands for one contractor queue up behind it, so a cooling-off check made after this call reads every
 * rating committed by the commands that went first. False when the contractor does not exist in this tenant.
 */
export async function lockContractorTx(tx: ScopedTx, tenantId: string, contractorId: string): Promise<boolean> {
  const rows = await tx.select({ id: contractors.id }).from(contractors)
    .where(and(eq(contractors.tenantId, tenantId), eq(contractors.id, contractorId)))
    .for("update")
    .limit(1);
  return rows.length > 0;
}

/**
 * GAP-WORKS-CONTRACTORS-DETAIL-04: the most recent rating of a contractor recorded by one officer, for the
 * cooling-off check. Null when that officer has never rated it.
 */
export async function latestRatingByActor(
  tenantId: string,
  contractorId: string,
  actorId: string,
): Promise<{ ratedAt: Date } | null> {
  return scopedRead((tx) => latestRatingByActorTx(tx, tenantId, contractorId, actorId));
}

/** Same lookup inside the caller's transaction (the consumer re-asserts the cooldown where it writes). */
export async function latestRatingByActorTx(
  tx: ScopedTx,
  tenantId: string,
  contractorId: string,
  actorId: string,
): Promise<{ ratedAt: Date } | null> {
  const rows = await tx.select({ ratedAt: contractorRatings.ratedAt }).from(contractorRatings)
    .where(and(
      eq(contractorRatings.tenantId, tenantId),
      eq(contractorRatings.contractorId, contractorId),
      eq(contractorRatings.ratedBy, actorId),
    ))
    .orderBy(desc(contractorRatings.ratedAt))
    .limit(1);
  return rows[0] ?? null;
}

/** A rating-history row plus the human work number of the work it is linked to (null when unlinked). */
export type RatingHistoryRow = ContractorRatingRow & { workNumber: string | null };

export async function listRatingHistory(
  tenantId: string,
  contractorId: string,
  limit = 50,
): Promise<RatingHistoryRow[]> {
  return scopedRead((tx) =>
    tx.select({ ...getTableColumns(contractorRatings), workNumber: workProposals.workNumber })
      .from(contractorRatings)
      .leftJoin(
        workProposals,
        and(eq(workProposals.id, contractorRatings.workId), eq(workProposals.tenantId, contractorRatings.tenantId)),
      )
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

/**
 * GAP2-WORKS-CONTRACTORS-03: tx-aware basic-info update used by the CQRS
 * consumer so the write and its audit event share ONE transaction. Returns
 * false when no row matched (contractor absent / wrong tenant) so the consumer
 * can reject the command. `pan` is written through the encryptedText custom
 * type (ciphertext at rest) exactly as the create path does.
 */
export async function applyContractorUpdate(
  tx: ScopedTx,
  tenantId: string,
  id: string,
  patch: Partial<ContractorInsert>,
  updatedBy: string,
): Promise<boolean> {
  const existing = await tx.select({ id: contractors.id }).from(contractors)
    .where(and(eq(contractors.id, id), eq(contractors.tenantId, tenantId)))
    .limit(1);
  if (existing.length === 0) return false;
  await tx
    .update(contractors)
    .set({ ...patch, updatedAt: new Date(), updatedBy })
    .where(and(eq(contractors.id, id), eq(contractors.tenantId, tenantId)));
  return true;
}
