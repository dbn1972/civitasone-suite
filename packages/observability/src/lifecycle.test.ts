/**
 * Unit tests for the REL-012 PM2 lifecycle helpers.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerGracefulShutdown, signalReady } from "./lifecycle.js";

function flush(times = 5): Promise<void> {
  return times <= 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => setImmediate(resolve)).then(() => flush(times - 1));
}

describe("signalReady", () => {
  afterEach(() => {
    delete process.send;
  });

  it("calls process.send('ready') when an IPC channel exists (PM2 fork mode)", () => {
    const send = vi.fn();
    process.send = send;

    signalReady();

    expect(send).toHaveBeenCalledWith("ready");
  });

  it("is a no-op outside PM2 (no process.send defined)", () => {
    delete process.send;

    expect(() => signalReady()).not.toThrow();
  });
});

describe("registerGracefulShutdown", () => {
  afterEach(() => {
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGINT");
    vi.restoreAllMocks();
  });

  it("runs cleanup() and exits 0 on SIGTERM", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as unknown as typeof process.exit);

    registerGracefulShutdown({ cleanup });
    process.emit("SIGTERM");
    await flush();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("exits 1 without hanging if cleanup() rejects", async () => {
    const cleanup = vi.fn().mockRejectedValue(new Error("boom"));
    const logger = { info: vi.fn(), error: vi.fn() };
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as unknown as typeof process.exit);

    registerGracefulShutdown({ cleanup, logger, forceExitMs: 5000 });
    process.emit("SIGTERM");
    await flush();

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalled();
  });

  it("ignores a second signal once shutdown is already in progress", async () => {
    let resolveCleanup: () => void = () => {};
    const cleanup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCleanup = resolve;
        }),
    );
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as unknown as typeof process.exit);

    registerGracefulShutdown({ cleanup });
    process.emit("SIGTERM");
    process.emit("SIGTERM"); // should be ignored — cleanup already running
    resolveCleanup();
    await flush();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("forces exit(1) if cleanup() never resolves before forceExitMs", async () => {
    vi.useFakeTimers();
    const cleanup = vi.fn(() => new Promise<void>(() => {})); // never resolves
    const logger = { info: vi.fn(), error: vi.fn() };
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as unknown as typeof process.exit);

    registerGracefulShutdown({ cleanup, logger, forceExitMs: 1000 });
    process.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(1000);

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
