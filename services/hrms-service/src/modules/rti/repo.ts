import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsRtiRequests, type RtiRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertRti(tx: Writer, row: typeof hrmsRtiRequests.$inferInsert): Promise<void> {
  await tx.insert(hrmsRtiRequests).values(row);
}

export async function listRti(tenantId: string, limit = 200): Promise<RtiRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsRtiRequests)
    .where(eq(hrmsRtiRequests.tenantId, tenantId))
    .orderBy(desc(hrmsRtiRequests.receivedDate))
    .limit(limit));
}

export async function getRti(tenantId: string, id: string): Promise<RtiRow | undefined> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsRtiRequests).where(and(
    eq(hrmsRtiRequests.id, id),
    eq(hrmsRtiRequests.tenantId, tenantId),
  )).limit(1));
  return rows[0];
}

type RtiSet = Partial<Pick<
  typeof hrmsRtiRequests.$inferInsert,
  "pioId" | "responseText" | "respondedDate" | "appealText" | "appealDate" | "closedDate"
>>;

/**
 * Guarded RTI state transition, run against an ALREADY-OPEN transaction.
 * TX-001: this is the variant callers that already hold a `tx` (e.g. the F3
 * leftover consumer's outer `db.transaction()`) must use -- it never opens
 * its own transaction, so it can't nest one inside another and deadlock the
 * pool under concurrent load. Only flips status when current status is in
 * `from`; bumps version + updatedAt. Returns the updated row, or null on
 * guard rejection (wrong state / not found).
 */
export async function transitionRtiTx(
  tx: Writer, tenantId: string, id: string, actorId: string,
  opts: { from: string[]; to: string; set?: RtiSet },
): Promise<RtiRow | null> {
  const rows = await tx.update(hrmsRtiRequests)
    .set({
      ...opts.set,
      status: opts.to,
      updatedBy: actorId,
      updatedAt: new Date(),
      version: sql`${hrmsRtiRequests.version} + 1`,
    })
    .where(and(
      eq(hrmsRtiRequests.id, id),
      eq(hrmsRtiRequests.tenantId, tenantId),
      inArray(hrmsRtiRequests.status, opts.from),
    ))
    .returning();
  return rows[0] ?? null;
}

/**
 * Guarded RTI state transition for callers with NO already-open transaction
 * (e.g. `routes.ts`/tests calling this standalone). Opens its own
 * transaction and delegates to `transitionRtiTx` -- never call this from
 * inside another transaction, use `transitionRtiTx(tx, ...)` there instead.
 */
export async function transitionRti(
  tenantId: string, id: string, actorId: string,
  opts: { from: string[]; to: string; set?: RtiSet },
): Promise<RtiRow | null> {
  return db.transaction((tx) => transitionRtiTx(tx, tenantId, id, actorId, opts));
}
