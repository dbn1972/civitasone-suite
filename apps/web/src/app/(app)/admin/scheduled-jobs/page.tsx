import { getAdminScheduledJobs } from "@/app/_data/loaders";
import { ScheduledJobsManager } from "./ScheduledJobsManager";
import { requireAnyRole } from "@/lib/auth/roleGuard";
import { ADMIN_PLATFORM_ROLES } from "@/lib/auth/adminRoles";

// COMP-004: this page used to hold 5 hardcoded INITIAL_JOBS + SAMPLE_HISTORY
// with every action (toggle, run-now, delete, create) mutating local state
// only. admin-service's scheduled-jobs module (registered in app.ts, its own
// real Postgres schema `scheduled_jobs`) already ships full CRUD +
// run-now/pause/resume + execution history — the field names (cronExpression,
// targetService, targetCommand, payload, enabled, lastRunAt, lastRunStatus,
// nextRunAt) match this page's model almost exactly. Now backed for real.
export default async function ScheduledJobsPage() {
  // GAP-ADMIN-SCHEDULED-JOBS-02: admin-service gates every scheduled-jobs route to platform_admin/super_admin.
  requireAnyRole(ADMIN_PLATFORM_ROLES);
  const { data: jobs, source } = await getAdminScheduledJobs();
  return <ScheduledJobsManager initialJobs={jobs} source={source} />;
}
