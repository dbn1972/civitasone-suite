import { cache } from "../../shared/infra.js";
import { RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import type { LocationView } from "./schema.js";
import type { LocationTreeNode } from "./validators.js";

export async function getLocation(id: string, tenantId: string): Promise<LocationView | null> {
  return cache.getOrLoad<LocationView>(
    cache.makeKey(tenantId, RESOURCE, id),
    () => repo.findById(id, tenantId)
  );
}

export async function listLocations(
  tenantId: string,
  limit: number,
  offset: number
): Promise<{ data: LocationView[]; pagination: { hasMore: boolean; pageSize: number; cursor?: string } }> {
  return cache.listOrLoad(tenantId, RESOURCE, `list:${limit}:${offset}`, async () => {
    const rows = await repo.listByTenant(tenantId, limit, offset);
    return {
      data: rows,
      pagination: {
        hasMore: rows.length === limit,
        pageSize: limit,
        ...(rows.length ? { cursor: String(offset + rows.length) } : {}),
      },
    };
  });
}

/**
 * Spatial nearby query: returns locations within radiusKm of (lat, lng).
 * Uses PostGIS GIST index for efficient spatial filtering.
 */
export async function findNearby(
  tenantId: string,
  lat: number,
  lng: number,
  radiusKm: number,
  limit: number
): Promise<{ data: Array<LocationView & { distanceKm: number }> }> {
  const results = await repo.findNearby(tenantId, lat, lng, radiusKm, limit);
  return { data: results };
}

/**
 * Builds the tenant's branch-office hierarchy as a nested tree (parent -> children)
 * from the flat location list. Roots are locations with no parent (or whose parent
 * is not visible to this tenant); children are sorted by name for stable output.
 */
export async function getLocationTree(tenantId: string): Promise<{ data: LocationTreeNode[] }> {
  const rows = await repo.listAllByTenant(tenantId);

  const nodeById = new Map<string, LocationTreeNode>();
  for (const row of rows) nodeById.set(row.id, { ...row, children: [] });

  const roots: LocationTreeNode[] = [];
  for (const node of nodeById.values()) {
    const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      // No parent, or a parent outside this tenant's visibility -> treat as root.
      roots.push(node);
    }
  }

  const byName = (a: LocationTreeNode, b: LocationTreeNode) => a.name.localeCompare(b.name);
  const sortTree = (nodes: LocationTreeNode[]) => {
    nodes.sort(byName);
    for (const n of nodes) sortTree(n.children);
  };
  sortTree(roots);

  return { data: roots };
}
