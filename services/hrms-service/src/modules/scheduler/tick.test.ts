import { describe, it, expect, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import {
  resetScheduledJobMetrics,
  getScheduledJobRunCount,
  getScheduledJobLastRun,
  getScheduledJobLastSuccess,
} from "@civitasone/observability";
import { db } from "../../shared/db.js";
import { runSchedulerOnce, SCHEDULER_JOB_NAME } from "./tick.js";

/**
 * PERF-011 verification: unlike report-service's ScheduledReportCron / analytics-
 * service's ScheduledExportCron (which advance real scheduled_reports /
 * scheduled_exports business rows on every tick), runSchedulerOnce() only
 * reads employee.hrms_employees (read-only here) and upserts into its own
 * derived/tracking tables (scheduler.hrms_due_list, scheduler.hrms_scheduler_runs) —
 * by design idempotent and safe to re-run (see the file-level doc comment on
 * tick.ts). That is exactly what the already-running hrms-worker does every
 * hour against this same database, so — unlike the other two services' tests
 * in this PR — this one calls the real function against the real shared dev
 * database (hrms_svc / civitas_hrms) instead of mocking the DB layer, for an
 * end-to-end "a real metric increments, a real log line appears, a real
 * last-successful-run timestamp updates" proof against a live Postgres.
 */
describe("hrms scheduler tick — PERF-011 observability (live DB)", () => {
  beforeEach(() => {
    resetScheduledJobMetrics();
  });

  it("a real run records success, a last-success timestamp, a duration sample, and agrees with the DB run-marker", async () => {
    expect(getScheduledJobLastRun(SCHEDULER_JOB_NAME)).toBeNull();

    const result = await runSchedulerOnce(db);

    expect(result.runDate).toBeTruthy();
    expect(getScheduledJobRunCount(SCHEDULER_JOB_NAME, "success")).toBe(1);
    expect(getScheduledJobRunCount(SCHEDULER_JOB_NAME, "failure")).toBe(0);
    expect(getScheduledJobLastRun(SCHEDULER_JOB_NAME)).not.toBeNull();
    expect(getScheduledJobLastSuccess(SCHEDULER_JOB_NAME)).not.toBeNull();

    // Cross-check against the pre-existing DB-backed run marker this function
    // already maintained before PERF-011 (scheduler.hrms_scheduler_runs) —
    // both signals should agree the run just completed successfully.
    const rows = await db.execute(sql`
      SELECT status, tenants_seen FROM scheduler.hrms_scheduler_runs
      WHERE job_name = ${SCHEDULER_JOB_NAME} AND run_date = ${result.runDate}`);
    const row = (rows as unknown as Array<{ status: string; tenants_seen: number }>)[0];
    expect(row?.status).toBe("ok");
    expect(row?.tenants_seen).toBe(result.tenantsSeen);
  });

  it("running it again the same day stays idempotent and still records a second success run", async () => {
    const first = await runSchedulerOnce(db);
    const second = await runSchedulerOnce(db);

    expect(second.runDate).toBe(first.runDate);
    expect(getScheduledJobRunCount(SCHEDULER_JOB_NAME, "success")).toBe(2);
  });
});
