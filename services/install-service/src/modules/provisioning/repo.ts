import { eq, and, desc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { siloProvisions } from "./schema.js";
import type { SiloProvisionRow, SiloProvisionInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findByTenantTx(tx: Writer, tenantId: string): Promise<SiloProvisionRow | null> {
  const rows = await (tx as typeof db).select().from(siloProvisions)
    .where(eq(siloProvisions.tenantId, tenantId)).limit(1);
  return rows[0] ?? null;
}

export async function findById(id: string): Promise<SiloProvisionRow | null> {
  const rows = await db.select().from(siloProvisions).where(eq(siloProvisions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function list(limit: number, status?: string): Promise<SiloProvisionRow[]> {
  const rows = await db.select().from(siloProvisions).orderBy(desc(siloProvisions.requestedAt)).limit(limit);
  return status ? rows.filter((r) => r.status === status) : rows;
}

export async function insert(tx: Writer, row: SiloProvisionInsert): Promise<void> {
  await tx.insert(siloProvisions).values(row);
}

export async function update(tx: Writer, id: string, patch: Partial<SiloProvisionInsert>): Promise<void> {
  await tx.update(siloProvisions).set({ ...patch, updatedAt: new Date() }).where(eq(siloProvisions.id, id));
}

export async function findByIdTenantTx(tx: Writer, id: string, tenantId: string): Promise<SiloProvisionRow | null> {
  const rows = await (tx as typeof db).select().from(siloProvisions)
    .where(and(eq(siloProvisions.id, id), eq(siloProvisions.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}
