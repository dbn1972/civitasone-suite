-- pay-matrix annual-increment idempotency (hard, DB-layer invariant).
--
-- POST /v1/hrms/pay-matrix/annual-increment already guards against re-running
-- the SAME effectiveDate via a synchronous pre-read (see routes.ts's
-- `alreadyIncremented` set, built from existing entry_type='increment' rows
-- for that date). That pre-read is best-effort: it protects a single
-- sequential run, but two genuinely concurrent requests for the same
-- effectiveDate (e.g. an admin double-clicking "Run Annual Increment") can
-- both read "not yet incremented" before either has written, then both
-- proceed to write.
--
-- This partial unique index makes "at most one increment entry per employee
-- per effective date" a hard constraint Postgres enforces itself, so
-- routes.ts can insert-first / conflict-check before ever touching
-- hrms_employees.basic_minor (see the accompanying routes.ts change) —
-- closing the race instead of merely narrowing it.
--
-- Partial (WHERE entry_type = 'increment') so it has zero effect on any other
-- service-book entry type recorded in this same shared table (promotion,
-- transfer, disciplinary, deputation, ...), some of which may legitimately
-- carry more than one entry for the same employee on the same date.
CREATE UNIQUE INDEX IF NOT EXISTS hrms_service_book_increment_once_per_date
  ON lifecycle.hrms_service_book_entries (tenant_id, employee_id, effective_date)
  WHERE entry_type = 'increment';
