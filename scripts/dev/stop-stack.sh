#!/usr/bin/env bash
# stop-stack.sh — kill all CivitasOne services started by start-stack.sh
set -euo pipefail

PID_DIR="/tmp/civitas-stack/pids"

if [ ! -d "$PID_DIR" ]; then
  echo "No running stack (PID dir not found: $PID_DIR)"
  exit 0
fi

killed=0
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

echo "Stopped $killed services."
