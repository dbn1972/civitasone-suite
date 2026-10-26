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
  claimed: false,
  limitCalls: 0,
  gate: null as Promise<void> | null,
  claimValues: [] as Record<string, unknown>[],
}));

vi.mock("../../shared/scanner-db.js", () => ({
  scannerDb: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            state.limitCalls++;
            if (state.gate) await state.gate;
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
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        update: () => ({
          set: (values: Record<string, unknown>) => ({
            where: () => {
              // Simulates the atomic compare-and-set: the first UPDATE that pushes
              // next_run_at into the future (the lease claim) wins; later ones match 0 rows.
              const isClaim = !("lastRunAt" in values);
              const result = isClaim
                ? (state.claimed ? [] : (state.claimed = true, [{ id: "claimed" }]))
                : [];
              if (isClaim) state.claimValues.push(values);
              return Object.assign(Promise.resolve(undefined), { returning: async () => result });
            },
          }),
        }),
      }),
  },
}));

vi.mock("../../shared/infra.js", () => ({
  queue: { publish: vi.fn(async () => undefined) },
  cache: {},
}));

const { tick, SCHEDULED_REPORT_CRON_JOB } = await import("./cron.js");
const { queue } = await import("../../shared/infra.js");
const { parseEnvelope, NOTIFICATION_SEND } = await import("@civitasone/events");

describe("ScheduledReportCron — PERF-011 scheduler observability", () => {
  beforeEach(() => {
    resetScheduledJobMetrics();
    state.dueReports = [];
    state.throwOnQuery = false;
    state.claimed = false;
    state.claimValues = [];
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

describe("ScheduledReportCron — CLOS3-S6-01 notification envelope validity", () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const due = (recipients: string[]) => ({
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    templateId: "33333333-3333-4333-8333-333333333333",
    format: "pdf",
    cadence: "daily",
    recipients,
  });
  const notifyEnvelopes = () =>
    vi.mocked(queue.publish).mock.calls
      .filter((c) => c[0] === NOTIFICATION_SEND)
      .map((c) => c[1] as Record<string, unknown>);

  beforeEach(() => {
    vi.mocked(queue.publish).mockClear();
    state.dueReports = [];
    state.throwOnQuery = false;
    state.claimed = false;
    state.claimValues = [];
  });

  it("publishes NOTIFICATION_SEND with a UUID messageId that parseEnvelope accepts", async () => {
    state.dueReports = [due(["a@b.gov.in"])];
    expect(await tick()).toBe(1);
    const envs = notifyEnvelopes();
    expect(envs).toHaveLength(1);
    const env = envs[0]!;
    expect(String(env.messageId)).toMatch(UUID_RE);
    expect(String(env.messageId).startsWith("notify-")).toBe(false);
    const parsed = parseEnvelope({ ...env, timestamp: new Date().toISOString() });
    expect(parsed.ok).toBe(true);
  });

  it("is deterministic per (job, recipient, attempt) and distinct across recipients", async () => {
    state.dueReports = [due(["a@b.gov.in", "c@d.gov.in"])];
    await tick();
    const [first, second] = notifyEnvelopes();
    expect(first!.messageId).not.toBe(second!.messageId);
    const { stableUuid } = await import("../../shared/outbox.js");
    const jobId = (first!.payload as { variables: { jobId: string } }).variables.jobId;
    expect(first!.messageId).toBe(stableUuid(`notify-${jobId}-a@b.gov.in-0`));
    expect(stableUuid(`notify-${jobId}-a@b.gov.in-1`)).not.toBe(first!.messageId);
  });
});

describe("ScheduledReportCron — CLOS3-S6-06 atomic lease claim + overlap guard", () => {
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    templateId: "33333333-3333-4333-8333-333333333333",
    format: "pdf",
    cadence: "daily",
    recipients: ["a@b.gov.in"],
  };
  const renderPublishes = () =>
    vi.mocked(queue.publish).mock.calls.filter((c) => c[0] === "reports.job.render");

  beforeEach(() => {
    vi.mocked(queue.publish).mockReset();
    vi.mocked(queue.publish).mockImplementation(async () => "id");
    state.dueReports = [row];
    state.throwOnQuery = false;
    state.claimed = false;
    state.claimValues = [];
  });

  it("two concurrent ticks dispatch the same due report exactly once", async () => {
    const [a, b] = await Promise.all([tick(), tick()]);
    expect(a + b).toBe(1);
    expect(renderPublishes()).toHaveLength(1);
  });

  it("claims with a lease in the future before publishing", async () => {
    const before = Date.now();
    await tick();
    expect(state.claimValues).toHaveLength(1);
    const lease = state.claimValues[0]!.nextRunAt as Date;
    expect(lease.getTime()).toBeGreaterThan(before + 60_000);
  });

  it("a dispatch failure after the claim leaves the lease (retry after expiry), not a lost report", async () => {
    vi.mocked(queue.publish).mockRejectedValueOnce(new Error("broker down"));
    expect(await tick()).toBe(0);
    // lease claimed; no lastRunAt written, nextRunAt not advanced to the real schedule
    expect(state.claimValues).toHaveLength(1);
  });

  it("startScheduledReportCron skips an overlapping tick while the previous one is still running", async () => {
    vi.useFakeTimers();
    try {
      process.env.REPORT_SCHEDULER_ENABLED = "true";
      state.dueReports = [];
      state.limitCalls = 0;
      let release!: () => void;
      state.gate = new Promise<void>((r) => { release = r; });
      const { startScheduledReportCron } = await import("./cron.js");
      const timer = startScheduledReportCron(1000)!;
      await vi.advanceTimersByTimeAsync(3500); // 3 interval firings while tick #1 is blocked
      expect(state.limitCalls).toBe(1);
      release();
      await vi.advanceTimersByTimeAsync(1000); // guard reset -> next firing runs
      expect(state.limitCalls).toBe(2);
      clearInterval(timer);
    } finally {
      state.gate = null;
      delete process.env.REPORT_SCHEDULER_ENABLED;
      vi.useRealTimers();
    }
  });
});
