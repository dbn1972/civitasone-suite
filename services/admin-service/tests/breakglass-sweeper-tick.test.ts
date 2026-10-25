/**
 * CLOS3-S4-13: the break-glass TTL sweeper must log sweep failures (not swallow them) and must
 * not start a second sweep while one is still running. Unit test: no Postgres.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findExpiredOpenTenantIds = vi.hoisted(() => vi.fn());
vi.mock("../src/modules/support/repo.js", () => ({ findExpiredOpenTenantIds }));
vi.mock("../src/shared/db.js", () => ({ db: {} }));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: vi.fn(), markProcessed: vi.fn() }));
vi.mock("@civitasone/db", () => ({ runWithTenant: vi.fn() }));

import { startBreakGlassSweeper } from "../src/modules/support/consumer.js";

describe("CLOS3-S4-13 startBreakGlassSweeper", () => {
  let handle: NodeJS.Timeout | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    findExpiredOpenTenantIds.mockReset();
  });
  afterEach(() => {
    if (handle) clearInterval(handle);
    handle = undefined;
    vi.useRealTimers();
  });

  it("logs a sweep failure with the error", async () => {
    const err = new Error("db down");
    findExpiredOpenTenantIds.mockRejectedValue(err);
    const logger = { error: vi.fn() };
    handle = startBreakGlassSweeper(1000, logger);
    await vi.advanceTimersByTimeAsync(1000);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err }), "break-glass sweep failed");
  });

  it("does not start an overlapping sweep, and resumes after it settles", async () => {
    let release!: (v: string[]) => void;
    findExpiredOpenTenantIds.mockImplementationOnce(() => new Promise<string[]>((r) => { release = r; }));
    findExpiredOpenTenantIds.mockResolvedValue([]);
    const logger = { error: vi.fn() };
    handle = startBreakGlassSweeper(1000, logger);
    await vi.advanceTimersByTimeAsync(3000);
    expect(findExpiredOpenTenantIds).toHaveBeenCalledTimes(1);
    release([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(findExpiredOpenTenantIds).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("the running flag resets after a rejection so the next tick still runs", async () => {
    findExpiredOpenTenantIds.mockRejectedValueOnce(new Error("boom"));
    findExpiredOpenTenantIds.mockResolvedValue([]);
    const logger = { error: vi.fn() };
    handle = startBreakGlassSweeper(1000, logger);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(findExpiredOpenTenantIds).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
