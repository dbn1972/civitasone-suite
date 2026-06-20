#!/usr/bin/env bash
set -euo pipefail

export PATH="$HOME/.npm-global/bin:$PATH"
SUITE="$HOME/CivitasOne/civitasone-suite"
PROMPTS="$SUITE/.claude/headless-prompts"
LOGS="$SUITE/.claude/headless-prompts/logs"
mkdir -p "$LOGS"

START_FROM="${1:-01}"

run_prompt() {
  local file="$1"
  local base
  base=$(basename "$file" .md)
  local log="$LOGS/${base}.log"

  echo ""
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║  [$(date '+%H:%M:%S')]  STARTING  ${base}"
  echo "╚══════════════════════════════════════════════════════╝"
  echo "  Log: $log"

  local num
  num=$(echo "$base" | cut -d'-' -f1)
  if [[ "$num" < "$START_FROM" ]]; then
    echo "  [SKIP] num=$num < start=$START_FROM"
    return 0
  fi

  cd "$SUITE"
  if claude -p "$(cat "$file")" --dangerously-skip-permissions 2>&1 | tee "$log"; then
    echo "✅  [$(date '+%H:%M:%S')]  DONE  ${base}"
  else
    echo "❌  [$(date '+%H:%M:%S')]  FAILED  ${base}"
    tail -20 "$log"
    echo "  Continuing..."
  fi
}

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║         CivitasOne Suite — Full Headless Build           ║"
echo "║         Started: $(date)"
echo "║         Resume from: $START_FROM"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ─── PHASE 1: Backend services ───────────────────────────────────────────────
echo "━━━ PHASE 1: Backend Services (01–07 = done, 08–12 = re-run) ━━━"
run_prompt "$PROMPTS/01-platform.md"
run_prompt "$PROMPTS/02-finance.md"
run_prompt "$PROMPTS/03-procurement.md"
run_prompt "$PROMPTS/04-hr.md"
run_prompt "$PROMPTS/05-establishment.md"
run_prompt "$PROMPTS/06-asset.md"
run_prompt "$PROMPTS/07-projects.md"
run_prompt "$PROMPTS/08-grants.md"
run_prompt "$PROMPTS/09-citizen.md"
run_prompt "$PROMPTS/10-audit-legal.md"
run_prompt "$PROMPTS/11-notification.md"
run_prompt "$PROMPTS/12-admin.md"

# ─── PHASE 2: Auth + Gap fixes ───────────────────────────────────────────────
echo ""
echo "━━━ PHASE 2: Auth Wiring + Gap Fixes ━━━"
run_prompt "$PROMPTS/13-wire-auth.md"
run_prompt "$PROMPTS/15-notification-adapters.md"
run_prompt "$PROMPTS/16-helpdesk-canonical-owner.md"
run_prompt "$PROMPTS/18-tenant-admin-live-metrics.md"
run_prompt "$PROMPTS/19-procurement-approvals-semantics.md"

# ─── PHASE 3: Greenfield modules ─────────────────────────────────────────────
echo ""
echo "━━━ PHASE 3: New Backend Modules ━━━"
run_prompt "$PROMPTS/17-knowledge-workflow-analytics.md"

# ─── PHASE 4: Web module screens ─────────────────────────────────────────────
echo ""
echo "━━━ PHASE 4: Web Screens — Module by Module ━━━"
run_prompt "$PROMPTS/30-web-finance.md"
run_prompt "$PROMPTS/31-web-hr.md"
run_prompt "$PROMPTS/32-web-procurement.md"
run_prompt "$PROMPTS/33-web-crm-helpdesk.md"
run_prompt "$PROMPTS/34-web-projects-grants.md"
run_prompt "$PROMPTS/35-web-establishment.md"
run_prompt "$PROMPTS/36-web-asset-stock.md"
run_prompt "$PROMPTS/37-web-audit-legal.md"
run_prompt "$PROMPTS/38-web-admin-platform.md"
run_prompt "$PROMPTS/39-web-analytics-knowledge.md"
run_prompt "$PROMPTS/40-web-run-all-update.md"

# ─── PHASE 5: Mobile + Testing + CI ─────────────────────────────────────────
echo ""
echo "━━━ PHASE 5: Mobile + Testing + CI/CD ━━━"
run_prompt "$PROMPTS/20-mobile-module-screens.md"
run_prompt "$PROMPTS/21-e2e-playwright-tests.md"
run_prompt "$PROMPTS/22-cicd-pipeline.md"

# ─── SUMMARY ─────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  BUILD COMPLETE  $(date)"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Run summary:"
for log in "$LOGS"/*.log; do
  [[ -f "$log" ]] || continue
  name=$(basename "$log" .log)
  lines=$(wc -l < "$log")
  last=$(tail -1 "$log" 2>/dev/null | cut -c1-80)
  if grep -q "✅" "$log" 2>/dev/null; then status="✅"; \
  elif grep -q "pnpm typecheck" "$log" 2>/dev/null; then status="⚠️"; \
  else status="❓"; fi
  echo "  $status $name ($lines lines)"
done
