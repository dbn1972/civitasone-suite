# QA Regression Summary - 2026-08-02

## Scope

Target services for readiness threshold over 90%:
- audit-service
- contract-service
- inventory-service

Frontend-to-backend validation included:
- apps/web test suite
- targeted backend suites above

## Results

- audit-service: 22/22 test files passed, 332/332 tests passed (100%)
- contract-service: 17/17 test files passed, 369/369 tests passed (100%)
- inventory-service: 19/19 test files passed, 479 passed, 1 skipped, 0 failed (>99% effective pass)
- apps/web: 240/240 test files passed, 1838/1838 tests passed (100%)

## Fixes applied in prior merge

- Added missing `audit.event.ingest` topic constant in audit service.
- Subscribed audit consumer to ingest topic for idempotency coverage.
- Stabilized contract integration polling loops in performance-bond regression test under suite load.

## Notes

- Full multi-service matrix artifact remains available at `reports/production-matrix-2026-08-02.tsv`.
- This note is added to preserve release audit trail for test campaign outcomes.
