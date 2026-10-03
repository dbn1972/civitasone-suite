import type { AdminUserStatusCounts, AdminUserSummary } from "@/app/_data/loaders";

/** GAP-ADMIN-USERS-03: URL + paging helpers for the server-side user directory. */
export type DirectoryState = {
  total: number;
  counts: AdminUserStatusCounts | null;
  page: number;
  pageSize: number;
  query: string;
  status: AdminUserSummary["status"] | null;
};

export function directoryHref(f: { q?: string; status?: string | null; page?: number }): string {
  const p = new URLSearchParams();
  if (f.q && f.q.trim()) p.set("q", f.q.trim());
  if (f.status) p.set("status", f.status);
  if (f.page && f.page > 1) p.set("page", String(f.page));
  const qs = p.toString();
  return qs ? `/admin/users?${qs}` : "/admin/users";
}

/** "Showing 26-50 of 1,240": the window of rows on this page within the filtered total. */
export function pageWindow(page: number, pageSize: number, total: number, shown: number): { first: number; last: number; hasPrev: boolean; hasNext: boolean } {
  const offset = (page - 1) * pageSize;
  const first = shown === 0 ? 0 : offset + 1;
  const last = offset + shown;
  return { first, last, hasPrev: page > 1, hasNext: last < total };
}

/** A status change moves one user between buckets; counts never go below zero. */
export function applyStatusDelta(counts: AdminUserStatusCounts, from: AdminUserSummary["status"], to: AdminUserSummary["status"]): AdminUserStatusCounts {
  if (from === to) return counts;
  return { ...counts, [from]: Math.max(0, counts[from] - 1), [to]: counts[to] + 1 };
}

/** The plain-language reason for a refused status change; null falls back to the generic message. */
export function statusRefusalMessage(code: unknown): string | null {
  if (code === "LAST_TENANT_ADMIN") {
    return "This is the last active tenant admin, so it cannot be suspended. Make someone else a tenant admin first.";
  }
  if (code === "SELF_STATUS_CHANGE") return "You cannot suspend, lock or deactivate your own account.";
  return null;
}
