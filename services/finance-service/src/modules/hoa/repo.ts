import { asc, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { financeMajorHeads, type MajorHeadRow } from "./schema.js";

export type Reader = Pick<typeof db, "select">;

export async function listMajorHeads(): Promise<MajorHeadRow[]> {
  return db.select().from(financeMajorHeads).orderBy(asc(financeMajorHeads.code));
}

/** Does a major head with this 4-digit code exist in the master? */
export async function majorHeadExists(code: string, reader: Reader = db): Promise<boolean> {
  const r = reader as typeof db;
  const rows = await r
    .select({ code: financeMajorHeads.code })
    .from(financeMajorHeads)
    .where(eq(financeMajorHeads.code, code))
    .limit(1);
  return rows.length > 0;
}
