import { eq, isNull, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { folders, type FolderRow, type FolderInsert, type FolderView } from "./schema.js";

export function toView(r: FolderRow): FolderView {
  return { id: r.id, tenantId: r.tenantId, parentId: r.parentId, name: r.name, path: r.path, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<FolderView[]> {
  const rows = await scopedRead((tx) =>
    tx.select().from(folders).where(eq(folders.tenantId, tenantId)).orderBy(desc(folders.updatedAt)).limit(limit).offset(offset)
  );
  return rows.map(toView);
}

export async function listByParent(tenantId: string, parentId: string | null): Promise<FolderView[]> {
  const cond = parentId
    ? and(eq(folders.tenantId, tenantId), eq(folders.parentId, parentId))
    : and(eq(folders.tenantId, tenantId), isNull(folders.parentId));
  const rows = await scopedRead((tx) => tx.select().from(folders).where(cond).orderBy(folders.name));
  return rows.map(toView);
}

export async function getById(tenantId: string, id: string): Promise<FolderView | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(folders).where(and(eq(folders.tenantId, tenantId), eq(folders.id, id))).limit(1)
  );
  return rows[0] ? toView(rows[0]) : null;
}

export type Writer = Pick<typeof db, "insert" | "update">;

export async function insert(tx: Writer, row: FolderInsert): Promise<void> {
  await tx.insert(folders).values(row);
}

export async function rename(tx: Writer, tenantId: string, id: string, name: string, actorId: string): Promise<void> {
  await tx.update(folders).set({ name, updatedBy: actorId, updatedAt: new Date() })
    // @ts-ignore drizzle where overload
    .where(and(eq(folders.tenantId, tenantId), eq(folders.id, id)));
}

export async function move(tx: Writer, tenantId: string, id: string, parentId: string | null, actorId: string): Promise<void> {
  await tx.update(folders).set({ parentId, updatedBy: actorId, updatedAt: new Date() })
    // @ts-ignore drizzle where overload
    .where(and(eq(folders.tenantId, tenantId), eq(folders.id, id)));
}
