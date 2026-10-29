import { eq, isNull, and, desc, sql } from "drizzle-orm";
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
type Exec = Pick<typeof db, "execute">;

/** `folders.path` is varchar(2000). */
export const MAX_PATH_LENGTH = 2000;

/**
 * #112: `path` is the chain of ancestor ids, root first: "/" for a root folder, "/<root>/.../<parent>/" below it.
 * It is always derived from the parent_id links (never from a stored path), so a legacy "/" path is corrected on
 * the next move, and a cycle already present in the data cannot loop the walk (the `seen` guard).
 */
export const childPathOf = (lineage: string[]): string => `/${lineage.join("/")}/`;

/** [root, ..., id] along parent_id, or null when `id` does not exist in the tenant. */
export async function lineage(tx: Exec, tenantId: string, id: string): Promise<string[] | null> {
  const rows = (await tx.execute(sql`
    WITH RECURSIVE up(id, parent_id, depth, seen) AS (
      SELECT f.id, f.parent_id, 0, ARRAY[f.id] FROM document.folders f WHERE f.tenant_id = ${tenantId} AND f.id = ${id}
      UNION ALL
      SELECT f.id, f.parent_id, up.depth + 1, up.seen || f.id
        FROM document.folders f JOIN up ON f.id = up.parent_id
       WHERE f.tenant_id = ${tenantId} AND NOT f.id = ANY(up.seen)
    )
    SELECT id::text AS id FROM up ORDER BY depth DESC`)) as unknown as { id: string }[];
  return rows.length > 0 ? rows.map((r) => r.id) : null;
}

export function lineageRead(tenantId: string, id: string): Promise<string[] | null> {
  return scopedRead((tx) => lineage(tx, tenantId, id));
}

/** Serialises one tenant's folder-tree writes until the transaction ends, so two crossing moves cannot both pass the cycle check. */
export async function lockTree(tx: Exec, tenantId: string): Promise<void> {
  const key = `document.folder-tree:${tenantId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export async function insert(tx: Writer, row: FolderInsert): Promise<void> {
  await tx.insert(folders).values(row);
}

export async function rename(tx: Writer, tenantId: string, id: string, name: string, actorId: string): Promise<boolean> {
  const rows = await tx.update(folders).set({ name, updatedBy: actorId, updatedAt: new Date() })
    .where(and(eq(folders.tenantId, tenantId), eq(folders.id, id)))
    .returning({ id: folders.id });
  return rows.length > 0;
}

export type MoveOutcome = "moved" | "not_found" | "parent_not_found" | "cycle" | "path_too_long";

/**
 * Move `id` under `parentId` (null = root) and recompute the path of the folder and its whole subtree, in the
 * caller's transaction. Re-checks at consume time, under the tenant tree lock, that the folder and the parent exist
 * and that the parent is neither the folder itself nor one of its descendants.
 */
export async function move(tx: Writer & Exec, tenantId: string, id: string, parentId: string | null, actorId: string): Promise<MoveOutcome> {
  await lockTree(tx, tenantId);
  if (!(await lineage(tx, tenantId, id))) return "not_found";
  let path = "/";
  if (parentId !== null) {
    const parent = await lineage(tx, tenantId, parentId);
    if (!parent) return "parent_not_found";
    if (parent.includes(id)) return "cycle";
    path = childPathOf(parent);
  }
  const subtree = sql`
    WITH RECURSIVE down(id, path, seen) AS (
      SELECT f.id, ${path}::text, ARRAY[f.id] FROM document.folders f WHERE f.tenant_id = ${tenantId} AND f.id = ${id}
      UNION ALL
      SELECT c.id, down.path || down.id::text || '/', down.seen || c.id
        FROM document.folders c JOIN down ON c.parent_id = down.id
       WHERE c.tenant_id = ${tenantId} AND NOT c.id = ANY(down.seen)
    )`;
  const [longest] = (await tx.execute(sql`${subtree} SELECT coalesce(max(length(path)), 0)::int AS n FROM down`)) as unknown as { n: number }[];
  if ((longest?.n ?? 0) > MAX_PATH_LENGTH) return "path_too_long";
  await tx.update(folders).set({ parentId, updatedBy: actorId, updatedAt: new Date() })
    .where(and(eq(folders.tenantId, tenantId), eq(folders.id, id)));
  await tx.execute(sql`${subtree} UPDATE document.folders f SET path = down.path FROM down WHERE f.tenant_id = ${tenantId} AND f.id = down.id`);
  return "moved";
}
