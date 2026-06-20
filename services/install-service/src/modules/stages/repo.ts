import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { stages, type StageRow, type StageInsert, type StageView } from "./schema.js";

function toView(r: StageRow): StageView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    stepNumber: r.stepNumber,
    description: r.description,
    status: r.status,
    version: r.version,
  };
}

export async function findById(id: string, tenantId: string): Promise<StageView | null> {
  const rows = await db.select().from(stages).where(eq(stages.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.tenantId !== tenantId) return null;
  return toView(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<StageView[]> {
  const rows = await db.select().from(stages).where(eq(stages.tenantId, tenantId)).limit(limit).offset(offset);
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: StageInsert): Promise<void> {
  await tx.insert(stages).values(row);
}

export { toView };
