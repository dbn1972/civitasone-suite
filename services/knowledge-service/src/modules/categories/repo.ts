import { eq, and, desc, isNull, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { categories, type CategoryRow, type CategoryInsert, type CategoryView } from "./schema.js";

const RESOURCE = "category";

export function toView(r: CategoryRow): CategoryView {
  return {
    id: r.id,
    tenantId: r.tenantId,
    parentId: r.parentId,
    name: r.name,
    slug: r.slug,
    description: r.description,
    icon: r.icon ?? null,
    sortOrder: r.sortOrder,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    createdBy: r.createdBy,
    updatedBy: r.updatedBy,
    version: r.version,
  };
}

export async function listByTenant(tenantId: string): Promise<CategoryView[]> {
  return cache.listOrLoad(tenantId, RESOURCE, "tree", async () => {
    const rows = await db.select().from(categories)
      .where(eq(categories.tenantId, tenantId))
      .orderBy(asc(categories.sortOrder), asc(categories.name));
    return rows.map(toView);
  });
}

export async function getById(tenantId: string, id: string): Promise<CategoryView | null> {
  return cache.getOrLoad(cache.makeKey(tenantId, RESOURCE, id), async () => {
    const rows = await db.select().from(categories)
      .where(eq(categories.id, id));
    if (!rows.length || rows[0]!.tenantId !== tenantId) return null;
    return toView(rows[0]!);
  });
}

export function buildTree(flatList: CategoryView[]): CategoryView[] {
  const map = new Map<string, CategoryView>();
  const roots: CategoryView[] = [];

  for (const item of flatList) {
    map.set(item.id, { ...item, children: [] });
  }

  for (const item of flatList) {
    const node = map.get(item.id)!;
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Get children of a category (direct descendants).
 */
export async function getChildren(tenantId: string, parentId: string): Promise<CategoryView[]> {
  const rows = await db.select().from(categories)
    .where(and(eq(categories.tenantId, tenantId), eq(categories.parentId, parentId)))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  return rows.map(toView);
}

/**
 * Walk up the tree to get all ancestors of a category (from nearest parent to root).
 */
export async function getAncestors(tenantId: string, id: string): Promise<CategoryView[]> {
  const all = await db.select().from(categories)
    .where(eq(categories.tenantId, tenantId));
  const map = new Map(all.map((r) => [r.id, r]));
  const ancestors: CategoryView[] = [];
  let current = map.get(id);
  while (current?.parentId) {
    const parent = map.get(current.parentId);
    if (!parent) break;
    ancestors.push(toView(parent));
    current = parent;
  }
  return ancestors;
}

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

export async function insert(tx: Writer, row: CategoryInsert): Promise<void> {
  await tx.insert(categories).values(row);
}

export async function update(tx: Writer, id: string, data: Partial<CategoryInsert>): Promise<void> {
  await tx.update(categories).set(data).where(eq(categories.id, id));
}

export async function remove(tx: Writer, id: string): Promise<void> {
  await tx.delete(categories).where(eq(categories.id, id));
}
