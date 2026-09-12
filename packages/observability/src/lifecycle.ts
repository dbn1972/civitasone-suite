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

/**
 * Minimal shape we need off Node's raw HTTP(S) server. Fastify exposes this
 * as `app.server`. Typed structurally (not imported from `node:http`) so
 * this package doesn't need to depend on any particular server framework.
 */
type CloseableServer = {
  closeIdleConnections?: () => void;
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
  /**
   * PERF-003 follow-up (independent review, 2026-09-12): the raw HTTP(S)
   * server behind an HTTP process (Fastify: pass `app.server`). Omit for
   * non-HTTP processes (queue workers) — the sweep below is a no-op unless
   * this is provided.
   *
   * Why this is needed: Fastify's `forceCloseConnections` defaults to
   * `'idle'` on Node >=19 (this fleet runs Node 22), which — once, at the
   * instant `app.close()` runs — calls the server's `closeIdleConnections()`.
   * That call is safe for in-flight requests by construction: Node's own
   * implementation (lib/_http_server.js) skips any socket whose
   * `_httpMessage` is not yet `finished`. But it is a single point-in-time
   * sweep. A socket that is genuinely mid-request at that instant and goes
   * idle (kept open via ordinary HTTP keep-alive — the normal condition for
   * any persistent client: another service, a monitoring probe) a moment
   * later is never revisited, so `app.close()`'s callback never fires and
   * the process hangs for the full `forceExitMs` before being force-killed.
   *
   * This is NOT fixed by passing `forceCloseConnections: true` to the
   * Fastify constructor instead. Verified against the installed Fastify
   * 4.29.1 and Node 22 sources: on Node >=18.2 (`server.closeAllConnections`
   * exists), `true` makes Fastify call that method, and Node's own
   * implementation destroys every tracked socket unconditionally — including
   * ones actively sending a request or awaiting a response. That trades an
   * over-cautious hang for occasionally severing a real in-flight response,
   * which is worse, not better.
   *
   * Instead, when `server` is supplied, we re-run Node's safe
   * `closeIdleConnections()` on an interval for the duration of the shutdown
   * window (in addition to Fastify's own one-shot sweep inside
   * `app.close()`), so a connection that goes idle after the first sweep is
   * still caught by the next one instead of being missed until
   * `forceExitMs`.
   */
  server?: CloseableServer;
  /**
   * Interval, in ms, between idle-connection sweeps while shutting down.
   * Only used when `server` is supplied. Default 200.
   */
  idleSweepIntervalMs?: number;
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

    // See the `server` option's doc comment above: repeatedly sweep idle
    // keep-alive sockets for the duration of shutdown so a connection that
    // goes idle after the first sweep doesn't hang the process until
    // forceExitMs. closeIdleConnections() never touches a socket that is
    // still mid-request, so this cannot sever an in-flight response.
    let sweepTimer: ReturnType<typeof setInterval> | undefined;
    const closeIdle = opts.server?.closeIdleConnections?.bind(opts.server);
    if (closeIdle) {
      closeIdle();
      sweepTimer = setInterval(closeIdle, opts.idleSweepIntervalMs ?? 200);
      sweepTimer.unref();
    }

    try {
      await opts.cleanup();
      clearTimeout(forceTimer);
      if (sweepTimer) clearInterval(sweepTimer);
      log.info?.("shutdown complete");
      process.exit(0);
    } catch (err) {
      clearTimeout(forceTimer);
      if (sweepTimer) clearInterval(sweepTimer);
      log.error?.({ err }, "error during shutdown");
      process.exit(1);
    }
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
