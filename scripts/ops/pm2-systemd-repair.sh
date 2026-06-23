#!/usr/bin/env bash
# 09-T3 — Repair PM2 systemd persistence + diagnose crash loops.
#
# Finding: `systemctl status pm2-ec2-user` = "Active: failed (Result: protocol)"
# (enabled but failed) → a reboot may NOT resurrect the 51 PM2 processes. Several
# services are also near the max_restarts:10 give-up threshold (web=65 restarts,
# procurement=18, finance=13, estab=11, hrms=11, payroll=10, grant=10).
#
# This script is SAFE by default: it only *diagnoses* and prints the exact
# privileged commands to run. The actual repair touches systemd (needs sudo) and
# is gated behind --apply so it is never run implicitly.
#
# Usage:
#   scripts/ops/pm2-systemd-repair.sh            # diagnose only (no changes)
#   scripts/ops/pm2-systemd-repair.sh --apply    # run the repair (needs sudo)
#
# Acceptance (09-T3):
#   - `systemctl status pm2-ec2-user` = active/enabled
#   - a test reboot resurrects all PM2 procs
#   - restart counts stop climbing after the fix
set -uo pipefail

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

PM2_USER="${PM2_USER:-$(whoami)}"
UNIT="pm2-${PM2_USER}"
LOG_DIR="${LOG_DIR:-/var/log/civitasone}"
HOME_DIR="${HOME:-/home/${PM2_USER}}"

hr() { printf '%s\n' "------------------------------------------------------------"; }
have() { command -v "$1" >/dev/null 2>&1; }

echo "=== 09-T3 PM2 systemd repair ($([[ $APPLY -eq 1 ]] && echo APPLY || echo DIAGNOSE)) ==="
echo "pm2 user: ${PM2_USER} | unit: ${UNIT}"
hr

if ! have pm2; then
  echo "ERROR: pm2 not on PATH. Install/locate pm2 before running this." >&2
  exit 2
fi

# ── 1. Current systemd unit state ────────────────────────────────────────────
echo "1. systemd unit state"
if have systemctl; then
  systemctl is-enabled "${UNIT}" 2>/dev/null | sed 's/^/   enabled: /' || echo "   enabled: <unknown>"
  systemctl is-active  "${UNIT}" 2>/dev/null | sed 's/^/   active:  /' || echo "   active:  <unknown>"
  echo "   --- last 15 journal lines ---"
  journalctl -u "${UNIT}" -n 15 --no-pager 2>/dev/null | sed 's/^/   /' || echo "   (journal unavailable — need sudo?)"
else
  echo "   systemctl not available on this host."
fi
hr

# ── 2. Crash-loop diagnosis (restart counts + recent errors) ─────────────────
echo "2. crash-loop diagnosis (restart counts, descending)"
if pm2 jlist >/tmp/pm2_jlist.json 2>/dev/null && have node; then
  node - <<'NODE' /tmp/pm2_jlist.json
const fs = require("fs");
let list = [];
try { list = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch { process.exit(0); }
const rows = list.map((p) => ({
  name: p.name,
  restarts: p.pm2_env?.restart_time ?? 0,
  unstable: p.pm2_env?.unstable_restarts ?? 0,
  status: p.pm2_env?.status,
  max: p.pm2_env?.max_restarts ?? "-",
  errlog: p.pm2_env?.pm_err_log_path ?? "",
})).sort((a, b) => b.restarts - a.restarts);
const near = rows.filter((r) => typeof r.max === "number" && r.restarts >= r.max);
for (const r of rows) {
  const flag = (typeof r.max === "number" && r.restarts >= r.max) ? "  <-- AT/OVER max_restarts" : "";
  console.log(`   ${String(r.restarts).padStart(4)} restarts  ${r.status.padEnd(10)} ${r.name}${flag}`);
}
// Stash the top offenders' error logs for section 3.
fs.writeFileSync("/tmp/pm2_offenders.txt", rows.slice(0, 5).map((r) => `${r.name}\t${r.errlog}`).join("\n"));
if (near.length) console.log(`\n   ${near.length} process(es) at/over max_restarts — these will NOT auto-recover.`);
NODE
else
  echo "   pm2 jlist unavailable; falling back to 'pm2 status':"
  pm2 status 2>/dev/null | sed 's/^/   /'
fi
hr

# ── 3. Recent error-log tails for the top offenders ──────────────────────────
echo "3. recent error logs (top offenders)"
if [[ -f /tmp/pm2_offenders.txt ]]; then
  while IFS=$'\t' read -r name errlog; do
    [[ -z "${name}" ]] && continue
    echo "   --- ${name} (${errlog:-no err log path}) ---"
    if [[ -n "${errlog}" && -f "${errlog}" ]]; then
      tail -n 12 "${errlog}" 2>/dev/null | sed 's/^/     /' || echo "     (unreadable)"
    else
      echo "     (no error log file found)"
    fi
  done < /tmp/pm2_offenders.txt
else
  echo "   (no offender list; skipping)"
fi
hr

# ── 4. Repair ─────────────────────────────────────────────────────────────────
echo "4. repair"
STARTUP_CMD="$(pm2 startup systemd -u "${PM2_USER}" --hp "${HOME_DIR}" 2>/dev/null | grep -E '^sudo ' | tail -n1)"
if [[ $APPLY -eq 0 ]]; then
  cat <<EOF
   DIAGNOSE-ONLY. To repair, run with --apply (or run these manually):

     # (a) regenerate + install the systemd unit (fixes "Active: failed"):
     ${STARTUP_CMD:-sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u ${PM2_USER} --hp ${HOME_DIR}}

     # (b) snapshot the current process list so reboot resurrects it:
     pm2 save

     # (c) confirm the unit is healthy:
     sudo systemctl daemon-reload
     sudo systemctl enable --now ${UNIT}
     systemctl status ${UNIT} --no-pager

   Then address the crash-loopers from sections 2-3 (fix root cause, then):
     pm2 reset all      # zero the restart counters after the fix
     pm2 save
EOF
else
  echo "   --apply set. Running repair (sudo will prompt as needed)..."
  if [[ -n "${STARTUP_CMD}" ]]; then
    echo "   -> ${STARTUP_CMD}"
    eval "${STARTUP_CMD}"
  else
    echo "   -> sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u ${PM2_USER} --hp ${HOME_DIR}"
    sudo env PATH="$PATH:/usr/bin" pm2 startup systemd -u "${PM2_USER}" --hp "${HOME_DIR}"
  fi
  pm2 save
  if have systemctl; then
    sudo systemctl daemon-reload
    sudo systemctl enable --now "${UNIT}" 2>/dev/null || true
    echo "   --- post-repair unit state ---"
    systemctl is-enabled "${UNIT}" 2>/dev/null | sed 's/^/   enabled: /'
    systemctl is-active  "${UNIT}" 2>/dev/null | sed 's/^/   active:  /'
  fi
  echo "   Repair done. Verify with a controlled reboot, then 'pm2 reset all' once crash loops are fixed."
fi
hr
echo "Done. See scripts/ops/pm2-systemd-repair.md for the full runbook and acceptance steps."
