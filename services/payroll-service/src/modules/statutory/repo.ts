import { db } from "../../shared/db.js";
import { payrollPf, payrollTds, payrollEsi, payrollGratuity } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPf(tx: Writer, row: typeof payrollPf.$inferInsert): Promise<void> {
  await tx.insert(payrollPf).values(row);
}

export async function insertEsi(tx: Writer, row: typeof payrollEsi.$inferInsert): Promise<void> {
  await tx.insert(payrollEsi).values(row);
}

export async function insertTds(tx: Writer, row: typeof payrollTds.$inferInsert): Promise<void> {
  await tx.insert(payrollTds).values(row);
}

export async function insertGratuity(tx: Writer, row: typeof payrollGratuity.$inferInsert): Promise<void> {
  await tx.insert(payrollGratuity).values(row);
}
