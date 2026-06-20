import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { roleBindings, breakglass, type BindingInsert, type BreakglassInsert } from "./schema.js";
import type { BindingView, BreakglassView } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertBinding(tx: Writer, row: BindingInsert): Promise<void> {
  await tx.insert(roleBindings).values(row);
}
export async function revokeBinding(tx: Writer, id: string, actorId: string, version: number): Promise<void> {
  await tx.update(roleBindings).set({ status: "revoked", updatedBy: actorId, version, updatedAt: new Date() }).where(eq(roleBindings.id, id));
}
export async function findBindingByIdTx(tx: Writer, id: string): Promise<BindingView | null> {
  const rows = await tx.select().from(roleBindings).where(eq(roleBindings.id, id)).limit(1);
  if (!rows[0]) return null;
  const r = rows[0];
  return { id: r.id, tenantId: r.tenantId, userId: r.userId, roleId: r.roleId, status: r.status, version: r.version };
}
export async function insertBreakglass(tx: Writer, row: BreakglassInsert): Promise<void> {
  await tx.insert(breakglass).values(row);
}
