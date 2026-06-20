import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { projectUcStatements, projectUcItems, type UcStatementInsert, type UcItemInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertUcStatement(tx: Writer, row: UcStatementInsert): Promise<void> {
  await tx.insert(projectUcStatements).values(row);
}

export async function insertUcItems(tx: Writer, rows: UcItemInsert[]): Promise<void> {
  if (rows.length) await tx.insert(projectUcItems).values(rows);
}

export async function listUcStatementsByScheme(schemeId: string): Promise<(typeof projectUcStatements.$inferSelect)[]> {
  return db.select().from(projectUcStatements).where(eq(projectUcStatements.schemeId, schemeId));
}
