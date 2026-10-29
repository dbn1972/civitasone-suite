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

export type FolderNode = { id: string; name: string };

/**
 * #112: `path` is the human-readable NAME path of the folder, root first and including the folder itself
 * ("/Budget", "/Budget/2026/Q1"); the web shows it under the name and as the folder dropdown label. Names cannot
 * contain "/" (validators.ts). It is always derived from the parent_id links (never from a stored path), so a
 * legacy "/" path is corrected on the next rename/move. Cycle checks use the ids of the same parent_id walk.
 */
export const namePath = (lineage: FolderNode[]): string => lineage.map((n) => `/${n.name}`).join("");

/** [root, ..., id] along parent_id, or null when `id` does not exist in the tenant. A cycle already in the data cannot loop (`seen`). */
export async function lineage(tx: Exec, tenantId: string, id: string): Promise<FolderNode[] | null> {
  const rows = (await tx.execute(sql`
    WITH RECURSIVE up(id, name, parent_id, depth, seen) AS (
      SELECT f.id, f.name, f.parent_id, 0, ARRAY[f.id] FROM document.folders f WHERE f.tenant_id = ${tenantId} AND f.id = ${id}
      UNION ALL
      SELECT f.id, f.name, f.parent_id, up.depth + 1, up.seen || f.id
        FROM document.folders f JOIN up ON f.id = up.parent_id
       WHERE f.tenant_id = ${tenantId} AND NOT f.id = ANY(up.seen)
    )
    SELECT id::text AS id, name FROM up ORDER BY depth DESC`)) as unknown as FolderNode[];
  return rows.length > 0 ? rows.map((r) => ({ id: r.id, name: r.name })) : null;
}

/** Serialises one tenant's folder-tree writes until the transaction ends (crossing moves; a rename racing a move). */
export async function lockTree(tx: Exec, tenantId: string): Promise<void> {
  const key = `document.folder-tree:${tenantId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** New name paths of `id` and its whole subtree, given the parent's name path (`base`, "" at root) and an optional new name for `id`. */
const subtreeCte = (tenantId: string, id: string, base: string, newName: string | null) => sql`
  WITH RECURSIVE down(id, path, seen) AS (
    SELECT f.id, ${base}::text || '/' || coalesce(${newName}::text, f.name), ARRAY[f.id]
      FROM document.folders f WHERE f.tenant_id = ${tenantId} AND f.id = ${id}
    UNION ALL
    SELECT c.id, down.path || '/' || c.name, down.seen || c.id
      FROM document.folders c JOIN down ON c.parent_id = down.id
     WHERE c.tenant_id = ${tenantId} AND NOT c.id = ANY(down.seen)
  )`;

async function subtreeMaxLength(tx: Exec, tenantId: string, id: string, base: string, newName: string | null): Promise<number> {
  const [r] = (await tx.execute(sql`${subtreeCte(tenantId, id, base, newName)} SELECT coalesce(max(length(path)), 0)::int AS n FROM down`)) as unknown as { n: number }[];
  return r?.n ?? 0;
}

async function writeSubtreePaths(tx: Exec, tenantId: string, id: string, base: string): Promise<void> {
  await tx.execute(sql`${subtreeCte(tenantId, id, base, null)} UPDATE document.folders f SET path = down.path FROM down WHERE f.tenant_id = ${tenantId} AND f.id = down.id`);
}

export type TreeOutcome = "ok" | "not_found" | "parent_not_found" | "cycle" | "path_too_long";

/**
 * Validate a create / rename / move against the current tree (read-only; the route uses it for a synchronous 4xx,
 * the consumers re-run it under the tree lock). Returns the parent's name path (`base`) on success.
 *  - create: id = null, parentId = the new parent (or null), newName = the name
 *  - rename: id, parentId = undefined (keep), newName
 *  - move:   id, parentId = target (or null), newName = null
 */
export async function plan(tx: Exec, tenantId: string, id: string | null, parentId: string | null | undefined, newName: string | null): Promise<{ outcome: Exclude<TreeOutcome, "ok"> } | { outcome: "ok"; base: string }> {
  const own = id ? await lineage(tx, tenantId, id) : null;
  if (id && !own) return { outcome: "not_found" };
  let parent: FolderNode[] | null = null;
  if (parentId === undefined) parent = own ? own.slice(0, -1) : [];
  else if (parentId !== null) {
    parent = await lineage(tx, tenantId, parentId);
    if (!parent) return { outcome: "parent_not_found" };
    if (id && parent.some((n) => n.id === id)) return { outcome: "cycle" };
  }
  const base = parent ? namePath(parent) : "";
  const longest = id ? await subtreeMaxLength(tx, tenantId, id, base, newName) : base.length + 1 + (newName ?? "").length;
  if (longest > MAX_PATH_LENGTH) return { outcome: "path_too_long" };
  return { outcome: "ok", base };
}

export function planRead(tenantId: string, id: string | null, parentId: string | null | undefined, newName: string | null) {
  return scopedRead((tx) => plan(tx, tenantId, id, parentId, newName));
}

/** Create under the tree lock; null when the create no longer fits (parent gone or path too long). */
export async function create(tx: Writer & Exec, row: FolderInsert & { parentId: string | null }): Promise<TreeOutcome> {
  await lockTree(tx, row.tenantId);
  const p = await plan(tx, row.tenantId, null, row.parentId, row.name);
  if (p.outcome !== "ok") return p.outcome;
  await tx.insert(folders).values({ ...row, path: `${p.base}/${row.name}` });
  return "ok";
}

/** Rename and recompute the path of the folder and every descendant, in the caller's transaction under the tree lock. */
export async function rename(tx: Writer & Exec, tenantId: string, id: string, name: string, actorId: string): Promise<TreeOutcome> {
  await lockTree(tx, tenantId);
  const p = await plan(tx, tenantId, id, undefined, name);
  if (p.outcome !== "ok") return p.outcome;
  await tx.update(folders).set({ name, updatedBy: actorId, updatedAt: new Date() })
    .where(and(eq(folders.tenantId, tenantId), eq(folders.id, id)));
  await writeSubtreePaths(tx, tenantId, id, p.base);
  return "ok";
}

/**
 * Move `id` under `parentId` (null = root) and recompute the path of the folder and its whole subtree, in the
 * caller's transaction. Re-checks at consume time, under the tenant tree lock, that the folder and the parent exist,
 * that the parent is neither the folder itself nor one of its descendants, and that every new path fits.
 */
export async function move(tx: Writer & Exec, tenantId: string, id: string, parentId: string | null, actorId: string): Promise<TreeOutcome> {
  await lockTree(tx, tenantId);
  const p = await plan(tx, tenantId, id, parentId, null);
  if (p.outcome !== "ok") return p.outcome;
  await tx.update(folders).set({ parentId, updatedBy: actorId, updatedAt: new Date() })
    .where(and(eq(folders.tenantId, tenantId), eq(folders.id, id)));
  await writeSubtreePaths(tx, tenantId, id, p.base);
  return "ok";
}
