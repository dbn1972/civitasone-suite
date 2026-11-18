#!/usr/bin/env bash
# select-evidence-dir.sh <downloaded-evidence-dir>
#
# Prints the directory release-gate.mjs should audit: every <YYYYMMDD> directory
# in the downloaded evidence pack that THIS run produced, merged into one.
#
# History of defects in the previous inline `find -type d -name '2*' | head -1`
# and in the later "newest dated dir only" version:
#  1. The repo carries a committed evidence/20260727/ (an old, hand-run pack) and
#     every lane job uploads `evidence/`, so that stale pack is in the download
#     next to the fresh one. Auditing it would be a stale PASS, the opposite of
#     "no artifact = fail". A directory that also exists in the checked-out tree
#     (evidence/<name>) is committed history, never this run's evidence: ignored.
#  2. When nothing matched it printed an empty string, which the gate read as
#     "use today's directory under the repo". Now the download root is returned,
#     so every lane reports UNMEASURED.
#  3. Each lane job stamps its own evidence/<YYYYMMDD>/ with `date -u` when IT
#     starts, and jobs of one run can straddle UTC midnight (main run 44201841017:
#     L3/L6 stamped 20261118, L0/L1/L2/L4/L10/L11 stamped 20261117). Picking only
#     the newest dated dir dropped every other lane -> UNMEASURED -> false BLOCK.
#     All non-committed dated dirs are now merged into one staging dir; on a
#     filename clash the newest wins. A lane whose evidence is truly absent is
#     still absent from the merge, so it still reports UNMEASURED.
set -euo pipefail
DL="${1:?usage: select-evidence-dir.sh <downloaded-evidence-dir>}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fresh=()
# Glob expansion is sorted, so later entries are newer.
for d in "$DL"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]; do
  [ -d "$d" ] || continue
  # Present in the checked-out tree => committed history, not this run's evidence.
  [ -e "$ROOT/evidence/$(basename "$d")" ] && continue
  fresh+=("$d")
done
if [ "${#fresh[@]}" -eq 0 ]; then
  echo "$DL"
  exit 0
fi
OUT="$DL/_run-evidence"
rm -rf "$OUT"
mkdir -p "$OUT"
for d in "${fresh[@]}"; do
  cp -p "$d"/* "$OUT"/ 2>/dev/null || true
done
echo "$OUT"
