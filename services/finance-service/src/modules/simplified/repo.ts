import { eq, and } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { simplifiedAccounts, type SimplifiedAccountRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * Tx-scoped lookup of a simplified-mode (MSME) account by its flat
 * chart-of-accounts code. Mirrors budget/repo.ts's findHeadByCodeTx, which
 * resolves the same kind of thing (a code -> account row, including whether
 * it is a postable leaf) for the full-GL chart of accounts (gl.finance_heads)
 * — but the two charts are entirely separate tables with no shared rows
 * (simplified tenants carry their own flat chart in simplified.accounts,
 * seeded from MSME_CHART_OF_ACCOUNTS), so simplified mode needs its own
 * resolver rather than being able to call budget/repo.ts's.
 */
export async function findAccountByCodeTx(
  tx: Writer, tenantId: string, code: string,
): Promise<SimplifiedAccountRow | null> {
  const rows = await (tx as typeof db).select().from(simplifiedAccounts)
    .where(and(eq(simplifiedAccounts.tenantId, tenantId), eq(simplifiedAccounts.code, code)))
    .limit(1);
  return rows[0] ?? null;
}
