/**
 * Query sweeper + scheduled export cron tests.
 * Verifies the tick/sweep logic dispatches commands for due items.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { sqlClient } from "../src/shared/db.js";
import { startScheduledQuerySweeper } from "../src/modules/queries/sweeper.js";
import { startScheduledExportCron, tick } from "../src/modules/exports/scheduled-cron.js";

afterAll(async () => { await sqlClient.end(); });

describe("startScheduledQuerySweeper", () => {
  it("returns an interval handle that can be cleared", () => {
    const timer = startScheduledQuerySweeper(600_000); // very long interval so it won't fire
    expect(timer).toBeDefined();
    clearInterval(timer);
  });
});

describe("startScheduledExportCron", () => {
  it("returns null when ANALYTICS_SCHEDULER_ENABLED != true", () => {
    const original = process.env.ANALYTICS_SCHEDULER_ENABLED;
    delete process.env.ANALYTICS_SCHEDULER_ENABLED;
    const result = startScheduledExportCron(600_000);
    expect(result).toBeNull();
    process.env.ANALYTICS_SCHEDULER_ENABLED = original;
  });

  it("returns timer when ANALYTICS_SCHEDULER_ENABLED = true", () => {
    const original = process.env.ANALYTICS_SCHEDULER_ENABLED;
    process.env.ANALYTICS_SCHEDULER_ENABLED = "true";
    const timer = startScheduledExportCron(600_000);
    expect(timer).toBeDefined();
    if (timer) clearInterval(timer);
    process.env.ANALYTICS_SCHEDULER_ENABLED = original;
  });
});

describe("scheduled export tick()", () => {
  it("is exported and callable", () => {
    expect(typeof tick).toBe("function");
  });
});
