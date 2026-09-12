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

  // PERF-003 follow-up: Fastify's forceCloseConnections defaults to 'idle'
  // on Node >=19, which sweeps idle keep-alive sockets exactly ONCE, at the
  // instant close() runs. A socket that is mid-request at that instant and
  // goes idle a moment later (ordinary keep-alive) is never revisited, so
  // shutdown hangs until forceExitMs. When `server` is supplied, we must
  // re-run closeIdleConnections() on an interval for the duration of the
  // shutdown window so that gap is closed — and the interval must stop once
  // cleanup finishes, so it doesn't leak past process exit.
  it("re-sweeps idle connections on an interval while cleanup is pending, and stops once done", async () => {
    vi.useFakeTimers();
    let resolveCleanup: () => void = () => {};
    const cleanup = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCleanup = resolve;
        }),
    );
    const closeIdleConnections = vi.fn();
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as unknown as typeof process.exit);

    registerGracefulShutdown({
      cleanup,
      server: { closeIdleConnections },
      idleSweepIntervalMs: 100,
      forceExitMs: 10_000,
    });
    process.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);

    // Swept once immediately when shutdown starts (mirrors Fastify's own
    // one-shot sweep — safe on its own but not sufficient by itself).
    expect(closeIdleConnections).toHaveBeenCalledTimes(1);

    // A connection that was mid-request at the first sweep and goes idle
    // afterwards must be caught by a later tick, not missed forever.
    await vi.advanceTimersByTimeAsync(350);
    expect(closeIdleConnections.mock.calls.length).toBeGreaterThanOrEqual(4);

    const callsBeforeDone = closeIdleConnections.mock.calls.length;
    resolveCleanup();
    // Not flush(): it uses real setImmediate, which vi.useFakeTimers() also
    // fakes, so it would never settle on its own — advance fake timers by 0
    // to let the cleanup-resolution microtasks/continuation run instead.
    await vi.advanceTimersByTimeAsync(0);

    expect(exit).toHaveBeenCalledWith(0);

    // No further sweeps once shutdown has completed (no leaked interval).
    await vi.advanceTimersByTimeAsync(1000);
    expect(closeIdleConnections.mock.calls.length).toBe(callsBeforeDone);

    vi.useRealTimers();
  });
});
