#!/bin/bash
# CivitasOne rollback — REL-012.
#
# Previously: pm2 stop all -> untar snapshot -> pnpm build -> pm2 restart all,
# with zero verification. That meant a broken snapshot / failed build was
# declared "ROLLBACK COMPLETE" the same as a healthy one, and the hard
# stop-then-start caused a guaranteed availability gap even on success.
#
# Now: pm2 reload (which, for any app configured with wait_ready/listen_timeout
# in ecosystem.config.js — see GRACEFUL_LIFECYCLE — holds the reloaded process
# out of "online" until it actually signals readiness, and gives it
# kill_timeout to drain in-flight work on the way down) followed by an
# explicit health probe of every service that exposes a PORT, plus a pm2
# status check covering workers (which have no HTTP surface to probe). The
# script now fails loudly (non-zero exit) instead of reporting success when
# the fleet did not actually come back healthy.
#
# NOTE: only services opted into GRACEFUL_LIFECYCLE (`{ graceful: true }` in
# ecosystem.config.js — finance-service + court-service as of REL-012) get
# the wait_ready hold and graceful-drain behavior from pm2 reload itself.
# Every other app still reloads the old way (pm2's best-effort fork-mode
# restart, no readiness gate) — but this script's post-reload health probe
# now catches a bad reload for ALL of them, opted-in or not, since it checks
# real HTTP health / pm2 process status rather than assuming success.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-$HOME/civitas-backups}"
SNAPSHOT_ROOT="${SNAPSHOT_ROOT:-$HOME/CivitasOne}"
SUITE_DIR="${SUITE_DIR:-$SNAPSHOT_ROOT/civitasone-suite}"
HEALTH_TIMEOUT_S="${HEALTH_TIMEOUT_S:-45}"
HEALTH_POLL_INTERVAL_S="${HEALTH_POLL_INTERVAL_S:-2}"

SNAPSHOT=$(ls -t "$BACKUP_DIR"/civitas-snapshot-*.tgz 2>/dev/null | head -1)
if [ -z "$SNAPSHOT" ]; then echo "ERROR: No snapshot found in $BACKUP_DIR"; exit 1; fi
echo "Rolling back to: $SNAPSHOT"

# Preserve the current pm2 process dump before touching anything, so a
# rollback that fails its own health check can be diagnosed (or manually
# restored with `pm2 resurrect`) without guessing what was running before.
PM2_HOME_DIR="${PM2_HOME:-$HOME/.pm2}"
mkdir -p "$BACKUP_DIR"
PM2_DUMP_BACKUP="$BACKUP_DIR/pm2-dump-pre-rollback-$(date +%Y%m%d%H%M%S).pm2"
pm2 save 2>/dev/null || true
if [ -f "$PM2_HOME_DIR/dump.pm2" ]; then
  cp "$PM2_HOME_DIR/dump.pm2" "$PM2_DUMP_BACKUP"
  echo "Pre-rollback pm2 dump saved: $PM2_DUMP_BACKUP"
fi

cd "$SNAPSHOT_ROOT" && tar -xzf "$SNAPSHOT"
cd "$SUITE_DIR" && pnpm build 2>&1 | tail -20

echo "Reloading via pm2 (graceful for services with wait_ready configured; see ecosystem.config.js GRACEFUL_LIFECYCLE)..."
pm2 reload all --update-env

echo "Probing health of reloaded services (timeout ${HEALTH_TIMEOUT_S}s per service)..."
FAILED=0

# Every app that sets env.PORT is an HTTP service — probe its /health.
# (Workers deliberately have no PORT/health endpoint; they're covered by the
# pm2-status check below instead.)
mapfile -t HEALTH_TARGETS < <(pm2 jlist | node -e '
  const apps = JSON.parse(require("fs").readFileSync(0, "utf8"));
  for (const a of apps) {
    const port = a.pm2_env && a.pm2_env.env && a.pm2_env.env.PORT;
    if (port) console.log(a.name + ":" + port);
  }
')

for target in "${HEALTH_TARGETS[@]}"; do
  name="${target%%:*}"
  port="${target##*:}"
  ok=0
  deadline=$((SECONDS + HEALTH_TIMEOUT_S))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if curl -sf -m 3 "http://127.0.0.1:${port}/health" > /dev/null 2>&1; then
      ok=1
      break
    fi
    sleep "$HEALTH_POLL_INTERVAL_S"
  done
  if [ "$ok" -eq 1 ]; then
    echo "  OK    ${name} (:${port})"
  else
    echo "  FAIL  ${name} (:${port}) did not become healthy within ${HEALTH_TIMEOUT_S}s"
    FAILED=1
  fi
done

# Catch everything else (workers included): any pm2 process not "online"
# after the reload/health-probe window means something didn't come back up.
NOT_ONLINE=$(pm2 jlist | node -e '
  const apps = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const bad = apps.filter(a => a.pm2_env.status !== "online").map(a => a.name + ":" + a.pm2_env.status);
  process.stdout.write(bad.join("\n"));
')
if [ -n "$NOT_ONLINE" ]; then
  echo "FAIL  process(es) not online after reload:"
  echo "$NOT_ONLINE" | sed 's/^/        /'
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  echo ""
  echo "ROLLBACK VERIFICATION FAILED — fleet is in a degraded/unknown state after reload."
  echo "Current pm2 status:"
  pm2 status
  echo ""
  echo "Pre-rollback pm2 dump is at: $PM2_DUMP_BACKUP (diagnostic only — not auto-restored;"
  echo "review manually, then \`pm2 resurrect\` from it if you need to revert this rollback attempt)."
  exit 1
fi

pm2 save
echo "ROLLBACK COMPLETE — all probed services healthy."
