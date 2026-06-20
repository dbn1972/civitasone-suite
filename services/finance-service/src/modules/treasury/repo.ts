import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { financeBanks, financeChallans, financeDeposits, type BankRow, type ChallanInsert, type DepositInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findBankById(id: string): Promise<BankRow | null> {
  const rows = await db.select().from(financeBanks).where(eq(financeBanks.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function insertChallan(tx: Writer, row: ChallanInsert): Promise<void> {
  await tx.insert(financeChallans).values(row);
}

export async function insertDeposit(tx: Writer, row: DepositInsert): Promise<void> {
  await tx.insert(financeDeposits).values(row);
}
