/**
 * ScheduledExportCron tests — verifies:
 *  - Env gate (ANALYTICS_SCHEDULER_ENABLED must be "true" to start)
 *  - computeNextRunAt correctness for each cadence
 *  - Cron tick dispatches exports for due entries
 *  - Cron tick updates nextRunAt after dispatching
 *  - Cron tick skips disabled entries
 *  - Cron tick skips entries not yet due
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { computeNextRunAt, isValidCadence } from "../src/modules/exports/scheduled-domain.js";
import { startScheduledExportCron } from "../src/modules/exports/scheduled-cron.js";

// ─── Domain Logic Tests (Pure, no DB) ────────────────────────────────────────

describe("computeNextRunAt", () => {
  describe("hourly cadence", () => {
    it("advances by exactly 1 hour", () => {
      const from = new Date("2026-07-10T14:30:00.000Z");
      const next = computeNextRunAt(from, "hourly");
      expect(next.toISOString()).toBe("2026-07-10T15:30:00.000Z");
    });

    it("rolls over midnight", () => {
      const from = new Date("2026-07-10T23:15:00.000Z");
      const next = computeNextRunAt(from, "hourly");
      expect(next.toISOString()).toBe("2026-07-11T00:15:00.000Z");
    });
  });

  describe("daily cadence", () => {
    it("advances by exactly 24 hours", () => {
      const from = new Date("2026-07-10T08:00:00.000Z");
      const next = computeNextRunAt(from, "daily");
      expect(next.toISOString()).toBe("2026-07-11T08:00:00.000Z");
    });

    it("handles end-of-month boundary", () => {
      const from = new Date("2026-07-31T12:00:00.000Z");
      const next = computeNextRunAt(from, "daily");
      expect(next.toISOString()).toBe("2026-08-01T12:00:00.000Z");
    });
  });

  describe("weekly cadence", () => {
    it("advances by exactly 7 days", () => {
      const from = new Date("2026-07-10T10:00:00.000Z");
      const next = computeNextRunAt(from, "weekly");
      expect(next.toISOString()).toBe("2026-07-17T10:00:00.000Z");
    });

    it("crosses month boundary", () => {
      const from = new Date("2026-07-28T10:00:00.000Z");
      const next = computeNextRunAt(from, "weekly");
      expect(next.toISOString()).toBe("2026-08-04T10:00:00.000Z");
    });
  });

  describe("monthly cadence", () => {
    it("advances to the same day next month", () => {
      const from = new Date("2026-07-15T09:00:00.000Z");
      const next = computeNextRunAt(from, "monthly");
      expect(next.toISOString()).toBe("2026-08-15T09:00:00.000Z");
    });

    it("clamps to last day of month when target month is shorter", () => {
      // Jan 31 → Feb 28 (2026 is not a leap year)
      const from = new Date("2026-01-31T12:00:00.000Z");
      const next = computeNextRunAt(from, "monthly");
      expect(next.toISOString()).toBe("2026-02-28T12:00:00.000Z");
    });

    it("handles leap year Feb 29", () => {
      // Jan 31 in a leap year → Feb 29
      const from = new Date("2028-01-31T12:00:00.000Z");
      const next = computeNextRunAt(from, "monthly");
      expect(next.toISOString()).toBe("2028-02-29T12:00:00.000Z");
    });

    it("rolls over year boundary", () => {
      const from = new Date("2026-12-15T10:00:00.000Z");
      const next = computeNextRunAt(from, "monthly");
      expect(next.toISOString()).toBe("2027-01-15T10:00:00.000Z");
    });

    it("handles Mar 31 → Apr 30 clamping", () => {
      const from = new Date("2026-03-31T08:00:00.000Z");
      const next = computeNextRunAt(from, "monthly");
      expect(next.toISOString()).toBe("2026-04-30T08:00:00.000Z");
    });

    it("preserves time components", () => {
      const from = new Date("2026-07-10T14:35:22.123Z");
      const next = computeNextRunAt(from, "monthly");
      expect(next.getUTCHours()).toBe(14);
      expect(next.getUTCMinutes()).toBe(35);
      expect(next.getUTCSeconds()).toBe(22);
      expect(next.getUTCMilliseconds()).toBe(123);
    });
  });
});

describe("isValidCadence", () => {
  it("accepts valid cadences", () => {
    expect(isValidCadence("hourly")).toBe(true);
    expect(isValidCadence("daily")).toBe(true);
    expect(isValidCadence("weekly")).toBe(true);
    expect(isValidCadence("monthly")).toBe(true);
  });

  it("rejects invalid cadences", () => {
    expect(isValidCadence("yearly")).toBe(false);
    expect(isValidCadence("")).toBe(false);
    expect(isValidCadence("minutely")).toBe(false);
  });
});

// ─── Env Gate Tests ──────────────────────────────────────────────────────────

describe("startScheduledExportCron — env gate", () => {
  const originalEnv = process.env.ANALYTICS_SCHEDULER_ENABLED;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ANALYTICS_SCHEDULER_ENABLED;
    } else {
      process.env.ANALYTICS_SCHEDULER_ENABLED = originalEnv;
    }
  });

  it("returns null when ANALYTICS_SCHEDULER_ENABLED is not set", () => {
    delete process.env.ANALYTICS_SCHEDULER_ENABLED;
    const timer = startScheduledExportCron(60_000);
    expect(timer).toBeNull();
  });

  it("returns null when ANALYTICS_SCHEDULER_ENABLED is 'false'", () => {
    process.env.ANALYTICS_SCHEDULER_ENABLED = "false";
    const timer = startScheduledExportCron(60_000);
    expect(timer).toBeNull();
  });

  it("returns null when ANALYTICS_SCHEDULER_ENABLED is empty string", () => {
    process.env.ANALYTICS_SCHEDULER_ENABLED = "";
    const timer = startScheduledExportCron(60_000);
    expect(timer).toBeNull();
  });

  it("returns a timer handle when ANALYTICS_SCHEDULER_ENABLED is 'true'", () => {
    process.env.ANALYTICS_SCHEDULER_ENABLED = "true";
    const timer = startScheduledExportCron(60_000);
    expect(timer).not.toBeNull();
    // Clean up the interval
    if (timer) clearInterval(timer);
  });
});

// ─── Cron Tick Integration Tests ─────────────────────────────────────────────

describe("ScheduledExportCron tick (integration)", () => {
  // These tests require a running database. They use the actual DB connection
  // from the analytics service to verify the cron picks up due exports.
  let dbMod: typeof import("../src/shared/db.js");
  let scheduledExportsMod: typeof import("../src/modules/exports/scheduled-schema.js");
  let tickFn: typeof import("../src/modules/exports/scheduled-cron.js").tick;
  let queueMod: typeof import("../src/shared/infra.js");
  const TENANT = randomUUID();
  const ACTOR = randomUUID();

  beforeAll(async () => {
    dbMod = await import("../src/shared/db.js");
    scheduledExportsMod = await import("../src/modules/exports/scheduled-schema.js");
    tickFn = (await import("../src/modules/exports/scheduled-cron.js")).tick;
    queueMod = await import("../src/shared/infra.js");
  });

  afterAll(async () => {
    // Clean up test data
    await dbMod.db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
    await dbMod.db.delete(scheduledExportsMod.scheduledExports)
      .where(eq(scheduledExportsMod.scheduledExports.tenantId, TENANT));
    await dbMod.sqlClient.end();
  });

  async function insertScheduledExport(overrides: Partial<{
    id: string;
    enabled: boolean;
    cadence: string;
    nextRunAt: Date;
    lastRunAt: Date | null;
  }> = {}) {
    const id = overrides.id ?? randomUUID();
    await dbMod.db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
    await dbMod.db.insert(scheduledExportsMod.scheduledExports).values({
      id,
      tenantId: TENANT,
      queryRunId: randomUUID(),
      format: "csv",
      cadence: overrides.cadence ?? "daily",
      recipients: ["user@example.com"],
      enabled: overrides.enabled ?? true,
      lastRunAt: overrides.lastRunAt ?? null,
      nextRunAt: overrides.nextRunAt ?? new Date(Date.now() - 60_000), // 1 min ago (due)
      createdBy: ACTOR,
      updatedBy: ACTOR,
    });
    return id;
  }

  it("dispatches export for due scheduled export and updates nextRunAt", async () => {
    const pastTime = new Date(Date.now() - 120_000); // 2 min ago
    const id = await insertScheduledExport({ nextRunAt: pastTime, cadence: "hourly" });

    // Spy on queue.publish to verify a command was dispatched
    const publishSpy = vi.spyOn(queueMod.queue, "publish");

    const dispatched = await tickFn();

    expect(dispatched).toBeGreaterThanOrEqual(1);
    expect(publishSpy).toHaveBeenCalled();

    // Verify the export command was published with correct topic
    const calls = publishSpy.mock.calls;
    const exportCall = calls.find(c => c[0] === "analytics.export.create");
    expect(exportCall).toBeDefined();

    // Verify nextRunAt was updated
    await dbMod.db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
    const rows = await dbMod.db
      .select()
      .from(scheduledExportsMod.scheduledExports)
      .where(eq(scheduledExportsMod.scheduledExports.id, id))
      .limit(1);
    const updated = rows[0];
    expect(updated).toBeDefined();
    expect(updated!.lastRunAt).not.toBeNull();
    // nextRunAt should be in the future (at least roughly now + 1 hour for hourly)
    expect(updated!.nextRunAt.getTime()).toBeGreaterThan(Date.now() - 5000);

    publishSpy.mockRestore();
  });

  it("skips disabled scheduled exports", async () => {
    const pastTime = new Date(Date.now() - 120_000);
    await insertScheduledExport({
      nextRunAt: pastTime,
      cadence: "daily",
      enabled: false,
    });

    const publishSpy = vi.spyOn(queueMod.queue, "publish");
    publishSpy.mockClear();

    // Note: other tests' due rows may also be picked up. We verify the disabled one is not.
    await tickFn();

    // The disabled entry should not trigger a command (no additional calls beyond other due items)
    // Since we can't isolate perfectly, check that lastRunAt was NOT updated for disabled entry
    await dbMod.db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
    const rows = await dbMod.db
      .select()
      .from(scheduledExportsMod.scheduledExports)
      .where(eq(scheduledExportsMod.scheduledExports.enabled, false))
      .limit(10);

    for (const row of rows) {
      if (row.tenantId === TENANT) {
        expect(row.lastRunAt).toBeNull();
      }
    }

    publishSpy.mockRestore();
  });

  it("skips entries where nextRunAt is in the future", async () => {
    const futureTime = new Date(Date.now() + 3_600_000); // 1 hour from now
    const id = await insertScheduledExport({ nextRunAt: futureTime, cadence: "weekly" });

    const publishSpy = vi.spyOn(queueMod.queue, "publish");
    publishSpy.mockClear();

    await tickFn();

    // Verify the future entry's lastRunAt is still null (not dispatched)
    await dbMod.db.execute(sql`SELECT set_config('app.tenant_id', ${TENANT}, false)`);
    const rows = await dbMod.db
      .select()
      .from(scheduledExportsMod.scheduledExports)
      .where(eq(scheduledExportsMod.scheduledExports.id, id))
      .limit(1);
    expect(rows[0]!.lastRunAt).toBeNull();

    publishSpy.mockRestore();
  });
});
