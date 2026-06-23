#!/bin/bash
set -euo pipefail
BACKUP_DIR="$HOME/civitas-backups"
SUITE_DIR="$HOME/CivitasOne/civitasone-suite"
SNAPSHOT=$(ls -t "$BACKUP_DIR"/civitas-snapshot-*.tgz 2>/dev/null | head -1)
if [ -z "$SNAPSHOT" ]; then echo "ERROR: No snapshot found"; exit 1; fi
echo "Rolling back to: $SNAPSHOT"
pm2 stop all 2>/dev/null || true
cd "$HOME/CivitasOne" && tar -xzf "$SNAPSHOT"
cd "$SUITE_DIR" && pnpm build 2>&1 | tail -5
pm2 restart all && pm2 save
echo "ROLLBACK COMPLETE"
