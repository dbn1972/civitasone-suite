#!/usr/bin/env bash
# select-evidence-dir.sh <downloaded-evidence-dir>
#
# Prints the directory release-gate.mjs should audit: the newest <YYYYMMDD>
# directory in the downloaded evidence pack that THIS run produced.
#
# Two defects in the previous inline `find -type d -name '2*' | head -1`:
#  1. It took whichever directory find happened to list first. The repo carries a
#     committed evidence/20260727/ (an old, hand-run pack) and every lane job
#     uploads `evidence/`, so that stale pack was in the download next to the
#     fresh one. Finding it first would have audited months-old results as if
#     they were this run's -- a stale PASS, the opposite of "no artifact = fail".
#  2. When nothing matched it printed an empty string, which the script then read
#     as "use today's directory under the repo".
# Here a directory that also exists in the checked-out tree (evidence/<name>) is
# committed history, never this run's evidence, and is ignored. With nothing
# left, the download root is returned so every lane reports UNMEASURED.
set -euo pipefail
DL="${1:?usage: select-evidence-dir.sh <downloaded-evidence-dir>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pick=""
# Glob expansion is sorted, so the last surviving directory is the newest.
for d in "$DL"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]; do
  [ -d "$d" ] || continue
  # Present in the checked-out tree => committed history, not this run's evidence.
  [ -e "$ROOT/evidence/$(basename "$d")" ] && continue
  pick="$d"
done
echo "${pick:-$DL}"
