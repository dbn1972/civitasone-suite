#!/usr/bin/env bash
# Regression test: install.sh runs under `set -euo pipefail`, where a bare
# ((x++)) with x=0 evaluates to 0 => exit status 1 => the script aborts.
# 1) prove the hazard, 2) prove the chosen form is safe, 3) lint install.sh.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fail=0

if bash -c 'set -euo pipefail; PASS=0; ((PASS++)); echo survived' >/dev/null 2>&1; then
  echo "NOTE: bare ((PASS++)) did not abort on this bash (unexpected)"
else
  echo "ok   hazard reproduced: bare ((PASS++)) aborts under set -e at 0"
fi

out=$(bash -c 'set -euo pipefail; PASS=0; FAIL=0; WARN=0; SKIP=0; STEP=0
  PASS=$((PASS + 1)); FAIL=$((FAIL + 1)); WARN=$((WARN + 1)); SKIP=$((SKIP + 1)); STEP=$((STEP + 1))
  echo "survived PASS=$PASS FAIL=$FAIL WARN=$WARN SKIP=$SKIP STEP=$STEP"' 2>&1) || { echo "FAIL safe form aborted"; fail=1; }
echo "ok   safe form: $out"

if bad=$(grep -nE '(^|[[:space:];])\(\([[:space:]]*[A-Za-z_]+[[:space:]]*(\+\+|--|\+=|-=)' "$ROOT/install.sh"); then
  echo "FAIL install.sh still contains abort-prone (( )) increments:"; echo "$bad"; fail=1
else
  echo "ok   install.sh has no bare (( )) increments"
fi

bash -n "$ROOT/install.sh" && echo "ok   bash -n install.sh" || fail=1
exit $fail
