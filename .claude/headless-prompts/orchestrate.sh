#!/usr/bin/env bash
# CivitasOne unattended parallel build orchestrator.
# Two concurrent lanes (file-contention-safe), then a final lane.
# Auto-retries on Claude session/usage limits.

export PATH="$HOME/.npm-global/bin:$PATH"
SUITE="$HOME/CivitasOne/civitasone-suite"
P="$SUITE/.claude/headless-prompts"
LOGS="$P/logs"
STATUS="$P/STATUS.tsv"
mkdir -p "$LOGS"
cd "$SUITE"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
note() { printf '%s\t%s\t%s\n' "$(ts)" "$1" "$2" >> "$STATUS"; }

# Run one prompt with a 90-min cap and retry-on-limit (max 8 tries, 30-min backoff).
run_prompt() {
  local num="$1" file="$P/$1-$2.md" log="$LOGS/$1-$2.log"
  [[ -f "$file" ]] || { note "$1-$2" "MISSING"; return 0; }
  note "$1-$2" "START"
  local try=1
  while [ $try -le 8 ]; do
    timeout 5400 claude -p "$(cat "$file")" --dangerously-skip-permissions > "$log" 2>&1
    if grep -qiE "session limit|usage limit|rate limit|resets [0-9]" "$log"; then
      note "$1-$2" "LIMIT-try$try-sleep30m"
      sleep 1800; try=$((try+1)); continue
    fi
    break
  done
  if grep -qiE "error|failed|✗" "$log" && ! grep -qiE "✓|done|complete|passed|typecheck" "$log"; then
    note "$1-$2" "DONE-warn"
  else
    note "$1-$2" "DONE"
  fi
}

# ─── Lane A: backend services + auth + gap fixes (touches services/, packages/) ───
lane_a() {
  note "LANE-A" "BEGIN backend"
  run_prompt 08 grants
  run_prompt 09 citizen
  run_prompt 10 audit-legal
  run_prompt 11 notification
  run_prompt 12 admin
  run_prompt 17 knowledge-workflow-analytics
  run_prompt 13 wire-auth
  run_prompt 15 notification-adapters
  run_prompt 16 helpdesk-canonical-owner
  run_prompt 18 tenant-admin-live-metrics
  run_prompt 19 procurement-approvals-semantics
  note "LANE-A" "END"
}

# ─── Lane B: web module screens (touches apps/web/, packages/schemas|types) ───
lane_b() {
  note "LANE-B" "BEGIN web"
  run_prompt 30 web-finance
  run_prompt 31 web-hr
  run_prompt 32 web-procurement
  run_prompt 33 web-crm-helpdesk
  run_prompt 34 web-projects-grants
  run_prompt 35 web-establishment
  run_prompt 36 web-asset-stock
  run_prompt 37 web-audit-legal
  run_prompt 38 web-admin-platform
  run_prompt 39 web-analytics-knowledge
  run_prompt 40 web-run-all-update
  note "LANE-B" "END"
}

# ─── Lane C: mobile + tests + CI (after A & B) ───
lane_c() {
  note "LANE-C" "BEGIN mobile/test/ci"
  run_prompt 20 mobile-module-screens
  run_prompt 21 e2e-playwright-tests
  run_prompt 22 cicd-pipeline
  note "LANE-C" "END"
}

note "ORCHESTRATOR" "START pid=$$"

# Snapshot source (rollback safety) — excludes heavy build artifacts.
SNAP="$HOME/civitas-snapshot-$(date +%Y%m%d-%H%M%S).tgz"
tar czf "$SNAP" -C "$SUITE" \
  --exclude='node_modules' --exclude='.next' --exclude='dist' --exclude='.turbo' \
  apps services packages infra 2>/dev/null
note "SNAPSHOT" "$SNAP"

# Launch A and B concurrently; wait for both; then C.
lane_a & PA=$!
lane_b & PB=$!
wait $PA
wait $PB
note "LANES-AB" "COMPLETE"
lane_c

note "ORCHESTRATOR" "ALL-DONE"
