#!/usr/bin/env bash
# stop-stack.sh — kill all CivitasOne services started by start-stack.sh
set -euo pipefail

PID_DIR="/tmp/civitas-stack/pids"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PORTS=(3001 3002 3003 3004 3005 3006 3007 3008 3009 3010 3011 3012 3013 3014 3015 3016 3017 3018 3019 3020 3021 3022 3023 3024 3025 3026 3027 3028 3029 3030 3031 4012 8080)

killed=0

if [ -d "$PID_DIR" ]; then
  for pidfile in "$PID_DIR"/*.pid; do
    [ -f "$pidfile" ] || continue
    name=$(basename "$pidfile" .pid)
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null && echo "[stop] $name (pid $pid)"
      killed=$((killed + 1))
    else
      echo "[gone] $name (pid $pid already dead)"
    fi
    rm -f "$pidfile"
  done
fi

# Also terminate orphan listeners on known service ports (stale dist from prior runs)
for port in "${PORTS[@]}"; do
  pids=$(ss -tlnp 2>/dev/null | grep ":${port} " | grep -oP 'pid=\K[0-9]+' | sort -u || true)
  for pid in $pids; do
    cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
    if echo "$cmd" | grep -q "${ROOT}/services/.*/dist/"; then
      kill "$pid" 2>/dev/null && echo "[stop] orphan on :${port} (pid $pid)" && killed=$((killed + 1))
    fi
  done
done

echo "Stopped $killed services."
