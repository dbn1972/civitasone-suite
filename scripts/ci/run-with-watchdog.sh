#!/usr/bin/env bash
# scripts/ci/run-with-watchdog.sh
#
# REL-010: the Accessibility job started its web server as a bare
# `command &` with only a one-time readiness wait (`wait-on`) and no
# supervision after that. When the server died partway through the axe-core
# run (observed in CI: `ERR_CONNECTION_REFUSED at http://localhost:3000/...`
# on the very next route after `/stock`), every remaining test failed with a
# generic connection-refused error, indistinguishable from a slow server or a
# genuinely broken route, and nothing attempted to recover or flag it.
#
# This starts a command in the background, waits for it to become reachable
# on a TCP port (same semantics as the existing `wait-on` calls it replaces),
# then supervises the process for the rest of the job. If it dies, it is
# restarted exactly once, with a loud, timestamped message in both the step
# log and the given log file plus the last lines of that log for context. A
# second death after the restart is recorded as a hard failure rather than
# retried again -- silently retrying forever would mask a genuinely broken
# server behind an indefinite hang instead of failing loudly with a
# diagnostic, which is what this exists to prevent.
#
# Usage: run-with-watchdog.sh <name> <port> <pidfile> <statusfile> <logfile> -- <command...>
#   name        short label used in log lines, e.g. "web" or "mock-gateway"
#   port        TCP port to poll for readiness and liveness
#   pidfile     where the current server PID is recorded
#   statusfile  written with one of: ok | restarted | restart_failed | crashed_twice
#   logfile     the server's own stdout+stderr (also where watchdog messages are appended)
#   command     the server command itself, run after `--`
#
# The supervisor loop runs detached in the background so this script returns
# once the server is first reachable -- the calling CI step is not held open
# for the life of the job. A later step should read `statusfile` after the
# real test step (see ci.yml's "Check web server health" step) and fail the
# job explicitly on restart_failed/crashed_twice, since those mean the test
# run's results (pass or fail) happened against a server that was flapping.

set -euo pipefail

if [ "$#" -lt 6 ]; then
  echo "usage: $0 <name> <port> <pidfile> <statusfile> <logfile> -- <command...>" >&2
  exit 2
fi

name="$1"; port="$2"; pidfile="$3"; statusfile="$4"; logfile="$5"; shift 5
if [ "$1" != "--" ]; then
  echo "expected -- before the command, got: $1" >&2
  exit 2
fi
shift

start_server() {
  # setsid: detach into a new session so the server outlives this function's
  # (and this step's) bash process, not just this invocation.
  setsid "$@" >>"$logfile" 2>&1 < /dev/null &
  echo $! > "$pidfile"
}

log() {
  echo "[watchdog:$name] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*" | tee -a "$logfile"
}

echo "ok" > "$statusfile"
: > "$logfile"

start_server "$@"
log "started pid $(cat "$pidfile"), waiting for tcp:$port"
npx --yes wait-on "tcp:localhost:$port" --timeout 120000

# Supervise for the rest of the job. Backgrounded + disowned so this script
# can return; GitHub Actions runs every step of a job in the same VM, so a
# disowned background process started here is still alive for later steps.
(
  restarted=0
  while true; do
    sleep 5
    live_pid="$(cat "$pidfile" 2>/dev/null || echo 0)"
    if ! kill -0 "$live_pid" 2>/dev/null; then
      if [ "$restarted" -eq 0 ]; then
        log "SERVER DIED (pid $live_pid). Restarting once. Last 40 log lines:"
        tail -n 40 "$logfile" 2>/dev/null || true
        restarted=1
        start_server "$@"
        if npx --yes wait-on "tcp:localhost:$port" --timeout 60000; then
          log "restarted OK as pid $(cat "$pidfile")"
          echo "restarted" > "$statusfile"
        else
          log "restart FAILED to become reachable within 60s"
          echo "restart_failed" > "$statusfile"
          exit 1
        fi
      else
        log "SERVER DIED AGAIN after the one restart -- not retrying further, failing loudly instead of masking it."
        echo "crashed_twice" > "$statusfile"
        exit 1
      fi
    fi
  done
) &
disown
log "supervising pid $(cat "$pidfile") in the background (watchdog subshell pid $!)"
