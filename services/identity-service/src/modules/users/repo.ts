import { eq, and } from "drizzle-orm";
import { db, scopedRead} from "../../shared/db.js";
import { users, type UserRow, type UserInsert } from "./schema.js";
import type { UserView } from "./domain.js";

function toView(r: UserRow): UserView {
  return {
    id: r.id, tenantId: r.tenantId, email: r.email, name: r.name,
    empCode: r.empCode ?? null, status: r.status as UserView["status"],
    mfaEnabled: r.mfaEnabled, version: r.version,
  };
}

export async function findById(tenantId: string, id: string): Promise<UserView | null> {
  const rows = await scopedRead((tx) => tx.select().from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
    .limit(1));
  return rows[0] ? toView(rows[0]) : null;
}

export async function findByTenantId(tenantId: string, limit = 50, offset = 0): Promise<UserView[]> {
  const rows = await scopedRead((tx) => tx.select().from(users)
    .where(eq(users.tenantId, tenantId))
    .limit(limit).offset(offset));
  return rows.map(toView);
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insert(tx: Writer, row: UserInsert): Promise<void> {
  await tx.insert(users).values(row);
}

export async function update(tx: Writer, tenantId: string, id: string, patch: Partial<UserInsert>): Promise<void> {
  await tx.update(users).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId)));
}

export async function findByIdTx(tx: Writer, tenantId: string, id: string): Promise<UserView | null> {
  const rows = await tx.select().from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId)))
    .limit(1);
  return rows[0] ? toView(rows[0]) : null;
}

export { toView };
