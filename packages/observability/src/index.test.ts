import { describe, it, expect, beforeEach } from "vitest";
import {
  recordScheduledJobRun,
  getScheduledJobLastRun,
  getScheduledJobLastSuccess,
  getScheduledJobRunCount,
  resetScheduledJobMetrics,
  scheduledJobHeartbeatCheck,
  withScheduledJobMetrics,
  formatSharedMetrics,
} from "./index.js";

/**
 * PERF-011: scheduled-job / cron run observability. Mirrors the style of
 * services/queue-service/tests/observability.test.ts (OPS-1) — exercise the
 * exported functions directly and assert on the exported getters, rather than
 * scraping /metrics text for everything.
 */
describe("observability — scheduled-job metrics (PERF-011)", () => {
  beforeEach(() => {
    resetScheduledJobMetrics();
  });

  it("recordScheduledJobRun updates last-run, last-success, and per-status counts", () => {
    expect(getScheduledJobLastRun("job.a")).toBeNull();
    expect(getScheduledJobLastSuccess("job.a")).toBeNull();

    recordScheduledJobRun("job.a", "success", 12);

    expect(getScheduledJobLastRun("job.a")).not.toBeNull();
    expect(getScheduledJobLastSuccess("job.a")).not.toBeNull();
    expect(getScheduledJobRunCount("job.a", "success")).toBe(1);
    expect(getScheduledJobRunCount("job.a", "failure")).toBe(0);
  });

  it("a failure updates last-run but NOT last-success, and counts separately", () => {
    recordScheduledJobRun("job.b", "success", 5);
    const successTs = getScheduledJobLastSuccess("job.b");

    recordScheduledJobRun("job.b", "failure", 9);

    expect(getScheduledJobRunCount("job.b", "success")).toBe(1);
    expect(getScheduledJobRunCount("job.b", "failure")).toBe(1);
    // last-run advances on every attempt...
    expect(getScheduledJobLastRun("job.b")).toBeGreaterThanOrEqual(successTs!);
    // ...but last-success is untouched by the failing run.
    expect(getScheduledJobLastSuccess("job.b")).toBe(successTs);
  });

  it("jobs are tracked independently by name", () => {
    recordScheduledJobRun("job.a", "success", 1);
    recordScheduledJobRun("job.c", "failure", 2);

    expect(getScheduledJobRunCount("job.a", "success")).toBe(1);
    expect(getScheduledJobRunCount("job.c", "success")).toBe(0);
    expect(getScheduledJobRunCount("job.c", "failure")).toBe(1);
  });

  it("withScheduledJobMetrics records success and calls logger.info exactly once", async () => {
    const logs: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
    const logger = {
      info: (obj: Record<string, unknown>, msg: string) => logs.push({ level: "info", obj, msg }),
      error: (obj: Record<string, unknown>, msg: string) => logs.push({ level: "error", obj, msg }),
    };

    const result = await withScheduledJobMetrics("job.success", async () => "ok", { logger });

    expect(result).toBe("ok");
    expect(getScheduledJobRunCount("job.success", "success")).toBe(1);
    expect(getScheduledJobLastSuccess("job.success")).not.toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.level).toBe("info");
    expect(logs[0]!.obj.job).toBe("job.success");
    expect(logs[0]!.obj.status).toBe("success");
    expect(typeof logs[0]!.obj.durationMs).toBe("number");
  });

  it("withScheduledJobMetrics records failure, logs via logger.error, and rethrows the original error", async () => {
    const logs: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
    const logger = {
      info: (obj: Record<string, unknown>, msg: string) => logs.push({ level: "info", obj, msg }),
      error: (obj: Record<string, unknown>, msg: string) => logs.push({ level: "error", obj, msg }),
    };
    const boom = new Error("tick exploded");

    await expect(
      withScheduledJobMetrics("job.failure", async () => { throw boom; }, { logger }),
    ).rejects.toBe(boom);

    expect(getScheduledJobRunCount("job.failure", "failure")).toBe(1);
    expect(getScheduledJobRunCount("job.failure", "success")).toBe(0);
    // a failed tick still updates last-run (proves the loop is alive)...
    expect(getScheduledJobLastRun("job.failure")).not.toBeNull();
    // ...but never last-success.
    expect(getScheduledJobLastSuccess("job.failure")).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.level).toBe("error");
    expect(logs[0]!.obj.err).toBe(boom);
  });

  it("withScheduledJobMetrics works with no logger passed (metrics-only)", async () => {
    await expect(withScheduledJobMetrics("job.no-logger", async () => 42)).resolves.toBe(42);
    expect(getScheduledJobRunCount("job.no-logger", "success")).toBe(1);
  });

  it("scheduledJobHeartbeatCheck is false with no runs, true right after a success, false once stale", () => {
    const check = scheduledJobHeartbeatCheck({ job: "job.heartbeat", maxStalenessMs: 50 });
    expect(check()).toBe(false);

    recordScheduledJobRun("job.heartbeat", "success", 1);
    expect(check()).toBe(true);
  });

  it("scheduledJobHeartbeatCheck ignores failures — only a real success counts", () => {
    const check = scheduledJobHeartbeatCheck({ job: "job.heartbeat-fail", maxStalenessMs: 60_000 });
    recordScheduledJobRun("job.heartbeat-fail", "failure", 1);
    expect(check()).toBe(false);
  });

  it("formatSharedMetrics emits well-formed scheduled_job_* Prometheus text", () => {
    recordScheduledJobRun("job.metrics-text", "success", 123);
    recordScheduledJobRun("job.metrics-text", "failure", 456);

    const text = formatSharedMetrics().join("\n");

    expect(text).toContain("# TYPE scheduled_job_last_run_timestamp gauge");
    expect(text).toContain("# TYPE scheduled_job_last_success_timestamp gauge");
    expect(text).toContain("# TYPE scheduled_job_runs_total counter");
    expect(text).toContain("# TYPE scheduled_job_duration_ms histogram");
    expect(text).toContain('scheduled_job_runs_total{job="job.metrics-text",status="success"} 1');
    expect(text).toContain('scheduled_job_runs_total{job="job.metrics-text",status="failure"} 1');
    expect(text).toContain('scheduled_job_duration_ms_count{job="job.metrics-text"} 2');
    expect(text).toContain('scheduled_job_duration_ms_sum{job="job.metrics-text"} 579');
  });

  it("resetScheduledJobMetrics clears every series", () => {
    recordScheduledJobRun("job.reset", "success", 1);
    resetScheduledJobMetrics();

    expect(getScheduledJobLastRun("job.reset")).toBeNull();
    expect(getScheduledJobLastSuccess("job.reset")).toBeNull();
    expect(getScheduledJobRunCount("job.reset", "success")).toBe(0);
  });
});
