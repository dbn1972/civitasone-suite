import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resetScheduledJobMetrics,
  getScheduledJobRunCount,
  getScheduledJobLastRun,
  getScheduledJobLastSuccess,
  withScheduledJobMetrics,
} from "@civitasone/observability";

/**
 * PERF-011 verification note: same reasoning as
 * services/report-service/src/modules/scheduled/cron.test.ts — this service's
 * vitest.config.ts otherwise points DATABASE_URL at the shared, long-lived
 * civitasone-postgres:5435 dev instance, and tick() would mutate real
 * `analytics.scheduled_exports` rows there if any are due. Mock the DB layer
 * instead so this exercises the real, unmodified `tick()` and
 * `withScheduledJobMetrics()` without touching that shared data.
 */
const state = vi.hoisted(() => ({
  dueExports: [] as unknown[],
  throwOnQuery: false,
}));

vi.mock("../../shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => {
                if (state.throwOnQuery) throw new Error("analytics db unavailable");
                return state.dueExports;
              },
            }),
          }),
        }),
        update: () => ({ set: () => ({ where: async () => undefined }) }),
      }),
  },
}));

vi.mock("../../shared/infra.js", () => ({
  queue: { publish: vi.fn(async () => undefined) },
  cache: {},
}));

const { tick, SCHEDULED_EXPORT_CRON_JOB } = await import("./scheduled-cron.js");

describe("ScheduledExportCron — PERF-011 scheduler observability", () => {
  beforeEach(() => {
    resetScheduledJobMetrics();
    state.dueExports = [];
    state.throwOnQuery = false;
  });

  it("a healthy no-op tick records a success run, a last-success timestamp, and a duration sample", async () => {
    expect(getScheduledJobLastRun(SCHEDULED_EXPORT_CRON_JOB)).toBeNull();

    const dispatched = await withScheduledJobMetrics(SCHEDULED_EXPORT_CRON_JOB, tick);

    expect(dispatched).toBe(0);
    expect(getScheduledJobRunCount(SCHEDULED_EXPORT_CRON_JOB, "success")).toBe(1);
    expect(getScheduledJobRunCount(SCHEDULED_EXPORT_CRON_JOB, "failure")).toBe(0);
    expect(getScheduledJobLastRun(SCHEDULED_EXPORT_CRON_JOB)).not.toBeNull();
    expect(getScheduledJobLastSuccess(SCHEDULED_EXPORT_CRON_JOB)).not.toBeNull();
  });

  it("a tick-wide failure records a failure run and rethrows", async () => {
    state.throwOnQuery = true;

    await expect(withScheduledJobMetrics(SCHEDULED_EXPORT_CRON_JOB, tick)).rejects.toThrow(
      "analytics db unavailable",
    );

    expect(getScheduledJobRunCount(SCHEDULED_EXPORT_CRON_JOB, "failure")).toBe(1);
    expect(getScheduledJobRunCount(SCHEDULED_EXPORT_CRON_JOB, "success")).toBe(0);
    expect(getScheduledJobLastRun(SCHEDULED_EXPORT_CRON_JOB)).not.toBeNull();
    expect(getScheduledJobLastSuccess(SCHEDULED_EXPORT_CRON_JOB)).toBeNull();
  });
});
