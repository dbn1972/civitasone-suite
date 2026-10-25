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
    transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ update: () => ({ set: () => ({ where: async () => undefined }) }) }),
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
