/**
 * Super-admin dashboard snapshot (GET /v1/admin/sa-dashboard).
 *
 * Fixes the route the frontend has called since it was built
 * (apps/web/src/app/(app)/admin/sa-dashboard/page.tsx via getSADashboard() in
 * _data/loaders.ts) but that never existed on this service — every request
 * 404'd (`Route GET:/v1/admin/sa-dashboard not found`), which fetchJson()
 * turns into `source: "error"` and the frontend's honest "Couldn't load —
 * showing nothing" empty state plus zeroed StatCards. See the PR description
 * for the full writeup.
 *
 * Every field below is real, no fabrication:
 *
 *  - activeTenants: a genuine `count(*) where status = 'active'` against this
 *    service's own tenants.admin_tenants table (tenants/repo.ts's
 *    countActive(), platform-wide via scopedPlatformRead — the exact same
 *    cross-tenant-bypass pattern tenants/routes.ts's list() already uses).
 *
 *  - metrics: five rows that reuse the SAME already-computed, real
 *    OperationsSnapshot that backs the sibling /v1/admin/operations route
 *    (health/operations.ts's getOperationsSnapshot() — real pm2 process
 *    state, a real queue.healthCheck(), a real outbox-pending count query).
 *    No new metric is invented here; each row's "status" classification
 *    (active / pending / failed) is a deterministic function of those real
 *    numbers, the same style operations.ts's own schedulerStatus() already
 *    uses to turn real pm2 state into an "online"/"owner_down" label.
 *
 * totalUsers is the one field this route CANNOT source honestly, and does
 * NOT fabricate. identity-service's users store is tenant-scoped only: see
 * identity-service/src/modules/users/queries.ts's listUsers(tenantId, ...)
 * and routes.ts's GET /identity/users, which always takes a single tenantId
 * and returns a plain, uncounted array (no `total`) — there is no
 * cross-tenant user count anywhere in this codebase. admin-service also has
 * no direct DB access to identity-service's database (database-per-service;
 * see shared/db.ts's SCHEMA map, which only wires this service's own
 * modules). Building a real cross-tenant total would mean either summing a
 * paginated per-tenant listUsers() call across every tenant (an N+1 that is
 * still not a true total once any one tenant exceeds a page) or adding a new
 * aggregate endpoint to identity-service — both out of scope for this fix
 * (see PR description's "left as an honest gap" section). totalUsers is
 * therefore explicitly `null` ("unknown"), never a fabricated 0, and the
 * frontend renders that as "—" (see page.tsx's honest-failure handling,
 * matching the same "—" convention already used by
 * apps/web/src/app/(app)/tenant-admin/mfa/page.tsx for the same reason).
 */
import { countActive } from "../tenants/repo.js";
import { getOperationsSnapshot } from "./operations.js";

export type SaDashboardMetricStatus = "active" | "pending" | "failed";

export type SaDashboardMetric = {
  metric: string;
  category: string;
  value: string;
  change: string;
  status: SaDashboardMetricStatus;
};

export type SaDashboardSnapshot = {
  activeTenants: number;
  /** Honest "unknown" — see this file's doc comment. Never a fabricated 0. */
  totalUsers: null;
  metrics: SaDashboardMetric[];
};

export async function getSaDashboardSnapshot(): Promise<SaDashboardSnapshot> {
  const [activeTenants, ops] = await Promise.all([
    countActive(),
    getOperationsSnapshot(),
  ]);
  const { summary } = ops;

  const metrics: SaDashboardMetric[] = [
    {
      metric: "Processes online",
      category: "Infrastructure",
      value: `${summary.onlineProcesses}/${summary.totalProcesses}`,
      change: "",
      status: summary.totalProcesses > 0 && summary.onlineProcesses === summary.totalProcesses ? "active" : "pending",
    },
    {
      metric: "Workers online",
      category: "Infrastructure",
      value: `${summary.workersOnline}/${summary.workersTotal}`,
      change: "",
      status: summary.workersTotal > 0 && summary.workersOnline === summary.workersTotal ? "active" : "pending",
    },
    {
      metric: "Queue health",
      category: "Infrastructure",
      value: summary.queueHealthy ? "Healthy" : "Unhealthy",
      change: "",
      status: summary.queueHealthy ? "active" : "failed",
    },
    {
      metric: "Outbox pending",
      category: "Infrastructure",
      value: String(summary.outboxPending),
      change: "",
      status: summary.outboxPending === 0 ? "active" : "pending",
    },
    {
      metric: "Failed jobs",
      category: "Infrastructure",
      value: String(summary.failedJobs),
      change: "",
      status: summary.failedJobs === 0 ? "active" : "failed",
    },
  ];

  return { activeTenants, totalUsers: null, metrics };
}
