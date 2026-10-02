import type { AdminUserSummary } from "@/app/_data/loaders";

/** GAP-ADMIN-USERS-05: stat-tile counts derived from the live user list. */
export function summarizeUsers(users: readonly Pick<AdminUserSummary, "status">[]) {
  const active = users.filter((u) => u.status === "active").length;
  const suspended = users.filter((u) => u.status === "suspended").length;
  return { total: users.length, active, suspended, other: users.length - active - suspended };
}
