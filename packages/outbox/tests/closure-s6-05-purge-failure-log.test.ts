/**
 * CLOS-S6-05 regression: a failing purge cycle must be reported via
 * opts.logger.warn (not silently swallowed), and must never throw/unhandled-reject.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { startOutboxPurge, type DrizzleTx } from "../src/index.js";

describe("startOutboxPurge failure reporting (CLOS-S6-05)", () => {
  afterEach(() => vi.useRealTimers());

  it("logs a warning when the purge cycle throws, and does not reject", async () => {
    vi.useFakeTimers();
    const boom = new Error("permission denied for table messages");
    const db = { execute: vi.fn().mockRejectedValue(boom) } as unknown as DrizzleTx;
    const logger = { warn: vi.fn() };
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    const timer = startOutboxPurge(db, { intervalMs: 1000, logger });
    await vi.advanceTimersByTimeAsync(1000);
    clearInterval(timer);
    process.off("unhandledRejection", unhandled);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith({ err: boom }, "outbox purge cycle failed");
    expect(unhandled).not.toHaveBeenCalled();
  });

  it("does not reject when no logger is supplied", async () => {
    vi.useFakeTimers();
    const db = { execute: vi.fn().mockRejectedValue(new Error("x")) } as unknown as DrizzleTx;
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    const timer = startOutboxPurge(db, { intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    clearInterval(timer);
    process.off("unhandledRejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
