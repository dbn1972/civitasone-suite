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
 * Guarded RTI state transition. Only flips status when current status is in
 * `from`; bumps version + updatedAt. Returns the updated row, or null on guard
 * rejection (wrong state / not found).
 */
export async function transitionRti(
  tenantId: string, id: string, actorId: string,
  opts: { from: string[]; to: string; set?: RtiSet },
): Promise<RtiRow | null> {
  const rows = await db.transaction((tx) => tx.update(hrmsRtiRequests)
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
    .returning());
  return rows[0] ?? null;
}
