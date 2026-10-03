import type { AdminPermissionSummary } from "@/app/_data/loaders";

/** getAdminPermissionsList requests `?limit=200`; a full page means the list may be cut off. */
export const PERMISSIONS_PAGE_LIMIT = 200;

export function permissionsTruncated(count: number): boolean {
  return count >= PERMISSIONS_PAGE_LIMIT;
}

/** Group heading for a permission key: the text before the first "." or ":" (or "general"). */
export function permissionPrefix(key: string): string {
  const m = /^([^.:]+)[.:]/.exec(key);
  return m ? m[1] : "general";
}

export type PermissionGroup = { prefix: string; items: AdminPermissionSummary[] };

/** Filter by name/key/description (case-insensitive) then group by key prefix, preserving order. */
export function groupPermissions(perms: readonly AdminPermissionSummary[], filter: string): PermissionGroup[] {
  const q = filter.trim().toLowerCase();
  const groups = new Map<string, AdminPermissionSummary[]>();
  for (const p of perms) {
    if (q && !`${p.key} ${p.name} ${p.description ?? ""}`.toLowerCase().includes(q)) continue;
    const prefix = permissionPrefix(p.key);
    const list = groups.get(prefix);
    if (list) list.push(p); else groups.set(prefix, [p]);
  }
  return [...groups.entries()].map(([prefix, items]) => ({ prefix, items }));
}
