import { eq } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsAppraisals, type AppraisalRow, type AppraisalInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update">;

export async function listByTenant(tenantId: string, limit = 100): Promise<AppraisalRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsAppraisals)
    .where(eq(hrmsAppraisals.tenantId, tenantId))
    .limit(limit));
}

export async function insertAppraisal(tx: Writer, row: AppraisalInsert): Promise<void> {
  await tx.insert(hrmsAppraisals).values(row);
}

export async function updateAppraisal(tx: Writer, id: string, patch: Partial<AppraisalInsert>): Promise<void> {
  await tx.update(hrmsAppraisals).set({ ...patch, updatedAt: new Date() }).where(eq(hrmsAppraisals.id, id));
}

export async function findById(id: string, tenantId: string): Promise<AppraisalRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsAppraisals).where(eq(hrmsAppraisals.id, id)).limit(1));
  const row = rows[0];
  return row && row.tenantId === tenantId ? row : null;
}
