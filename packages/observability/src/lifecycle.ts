/**
 * REL-012: PM2 graceful-lifecycle helpers.
 *
 * PM2's `wait_ready` mode holds a process out of the "online"/traffic-eligible
 * state until it sends an IPC `ready` message, or `listen_timeout` elapses
 * (whichever comes first) — see ecosystem.config.js. `pm2 reload` uses this to
 * bring the *new* instance of a process up before tearing down the old one,
 * so callers see zero dropped requests during a rolling restart/rollback.
 *
 * Call `signalReady()` once — and only once — a process has actually finished
 * getting ready to do its job:
 *   - an HTTP service: after `app.listen(...)` resolves.
 *   - a worker: after all its queue consumers are subscribed and any startup
 *     dependency (DB pool, outbox relay, etc.) is live.
 * Calling it earlier defeats the purpose of `wait_ready` — PM2 would route
 * traffic/work to a process that is still mid-initialization.
 *
 * `process.send` only exists when the process has an IPC channel to a
 * parent, which PM2 provides in fork mode (the mode this fleet uses). It is
 * `undefined` outside PM2 (dev, tests, CI), so this is a safe no-op there.
 */
export function signalReady(): void {
  if (typeof process.send === "function") {
    process.send("ready");
  }
}

// Method-shorthand (not arrow-typed) properties so real loggers — pino's
// Logger, Fastify's FastifyBaseLogger, console — are structurally assignable
// here: TypeScript checks method-shorthand signatures bivariantly, which
// tolerates pino/Fastify's more specific overloaded info(msg, ...args) style
// signatures instead of demanding the impossible info(...args: unknown[]).
type MinimalLogger = {
  info?(...args: unknown[]): void;
  error?(...args: unknown[]): void;
};

export interface GracefulShutdownOptions {
  /**
   * Release resources: close the HTTP server, stop queue consumers, end DB
   * pools, clear intervals. May reject — a rejection is logged and still
   * results in an exit (non-zero), it does not hang shutdown.
   */
  cleanup: () => Promise<void> | void;
  logger?: MinimalLogger;
  /**
   * Safety-net hard exit if cleanup() hangs. Keep this comfortably below
   * the process's PM2 kill_timeout (ecosystem.config.js) — PM2 sends
   * SIGKILL at kill_timeout regardless of whether this handler has returned,
   * so this exists to exit(1) cleanly with a log line before that happens,
   * rather than being killed mid-cleanup with no trace of why.
   */
  forceExitMs?: number;
}

/**
 * Registers SIGTERM/SIGINT handlers that run cleanup() then exit — the
 * counterpart to wait_ready/signalReady() on the shutdown side, and what
 * PM2's kill_timeout grace period is for. Idempotent against repeat
 * signals (a second SIGTERM while shutting down is ignored, not restarted).
 */
export function registerGracefulShutdown(opts: GracefulShutdownOptions): void {
  const log = opts.logger ?? {};
  const forceExitMs = opts.forceExitMs ?? 8000;
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info?.({ signal }, "shutting down");

    const forceTimer = setTimeout(() => {
      log.error?.({ signal, forceExitMs }, "graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, forceExitMs);
    forceTimer.unref();

    try {
      await opts.cleanup();
      clearTimeout(forceTimer);
      log.info?.("shutdown complete");
      process.exit(0);
    } catch (err) {
      clearTimeout(forceTimer);
      log.error?.({ err }, "error during shutdown");
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
