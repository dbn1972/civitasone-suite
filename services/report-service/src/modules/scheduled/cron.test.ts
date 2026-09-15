import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resetScheduledJobMetrics,
  getScheduledJobRunCount,
  getScheduledJobLastRun,
  getScheduledJobLastSuccess,
  withScheduledJobMetrics,
} from "@civitasone/observability";

/**
 * PERF-011 verification note: this service's vitest.config.ts otherwise points
 * DATABASE_URL / REPORT_SCANNER_DATABASE_URL at the shared, long-lived
 * civitasone-postgres:5435 dev instance. At the time this test was written
 * that instance's civitas_report database has 100+ real `reports.scheduled_reports`
 * rows already due (enabled AND next_run_at <= now()). tick() has no LIMIT-100
 * ordering guarantee and would advance lastRunAt/nextRunAt on whichever ~100 of
 * those real rows it selects — i.e. running the unmodified tick() against that
 * database here would silently reschedule reports this session does not own.
 *
 * So: mock the DB layer instead of touching that shared instance. This still
 * exercises the real, unmodified `tick()` and `withScheduledJobMetrics()` end to
 * end (real control flow, real metrics/log side effects) — only the query
 * result and the failure trigger are test doubles. See also
 * packages/observability/src/index.test.ts for direct coverage of
 * withScheduledJobMetrics()/recordScheduledJobRun() in isolation.
 */
const state = vi.hoisted(() => ({
  dueReports: [] as unknown[],
  throwOnQuery: false,
}));

vi.mock("../../shared/scanner-db.js", () => ({
  scannerDb: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (state.throwOnQuery) throw new Error("scanner db unavailable");
            return state.dueReports;
          },
        }),
      }),
    }),
  },
}));

vi.mock("../../shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  },
}));

vi.mock("../../shared/infra.js", () => ({
  queue: { publish: vi.fn(async () => undefined) },
  cache: {},
}));

const { tick, SCHEDULED_REPORT_CRON_JOB } = await import("./cron.js");

describe("ScheduledReportCron — PERF-011 scheduler observability", () => {
  beforeEach(() => {
    resetScheduledJobMetrics();
    state.dueReports = [];
    state.throwOnQuery = false;
  });

  it("a healthy no-op tick records a success run, a last-success timestamp, and a duration sample", async () => {
    expect(getScheduledJobLastRun(SCHEDULED_REPORT_CRON_JOB)).toBeNull();

    const dispatched = await withScheduledJobMetrics(SCHEDULED_REPORT_CRON_JOB, tick);

    expect(dispatched).toBe(0);
    expect(getScheduledJobRunCount(SCHEDULED_REPORT_CRON_JOB, "success")).toBe(1);
    expect(getScheduledJobRunCount(SCHEDULED_REPORT_CRON_JOB, "failure")).toBe(0);
    expect(getScheduledJobLastRun(SCHEDULED_REPORT_CRON_JOB)).not.toBeNull();
    expect(getScheduledJobLastSuccess(SCHEDULED_REPORT_CRON_JOB)).not.toBeNull();
  });

  it("a tick-wide failure (e.g. the BYPASSRLS scanner pool being unavailable) records a failure run and rethrows", async () => {
    state.throwOnQuery = true;

    await expect(withScheduledJobMetrics(SCHEDULED_REPORT_CRON_JOB, tick)).rejects.toThrow(
      "scanner db unavailable",
    );

    expect(getScheduledJobRunCount(SCHEDULED_REPORT_CRON_JOB, "failure")).toBe(1);
    expect(getScheduledJobRunCount(SCHEDULED_REPORT_CRON_JOB, "success")).toBe(0);
    // last-run still advances (the loop is alive, it just failed this tick)...
    expect(getScheduledJobLastRun(SCHEDULED_REPORT_CRON_JOB)).not.toBeNull();
    // ...but last-success must not.
    expect(getScheduledJobLastSuccess(SCHEDULED_REPORT_CRON_JOB)).toBeNull();
  });
});
