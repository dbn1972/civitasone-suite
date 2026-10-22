-- 0250_hrms_bulk_import_batches.sql
--
-- GAP-HR-EMPLOYEES-IMPORT-02: persisted state for POST /v1/hrms/employees/bulk.
-- The route used to answer 202 and forget the batch: GET .../bulk/status/:batchId
-- returned "completed" for ANY id and nothing recorded whether each queued
-- hrms.employee.create message actually created an employee. Now:
--   hrms_bulk_import_batches   one row per accepted POST (id = the batchId in the 202).
--   hrms_bulk_import_rows      one row per employee in it, 'pending' until the consumer
--                            marks it 'created' (in the SAME transaction as the employee
--                            insert) or 'failed' (terminal refusal / retries exhausted).
-- (Not the older employee.hrms_import_batches from migration 0004: that is an unused per-file
-- log with a different shape -- file_name NOT NULL, success/error counters -- that nothing in the
-- codebase reads or writes; it is deliberately left alone rather than bent to fit.)
-- message_id is the hrms.employee.create messageId, which is also the new employee's id.
-- Only an employee number and a stable failure code are stored here -- no PII, no raw
-- error text. Rows are tiny (<= 500 per batch); batches older than the retention
-- window can be removed with DELETE FROM employee.hrms_bulk_import_batches (rows cascade).
-- Additive + idempotent.
--
-- Rollback: DROP TABLE IF EXISTS employee.hrms_bulk_import_rows; DROP TABLE IF EXISTS employee.hrms_bulk_import_batches;

CREATE TABLE IF NOT EXISTS employee.hrms_bulk_import_batches (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL,
  total          integer NOT NULL,
  requested_by   uuid NOT NULL,
  correlation_id varchar(64),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_bulk_import_batches_total_check CHECK (total > 0 AND total <= 500)
);

CREATE INDEX IF NOT EXISTS hrms_bulk_import_batches_tenant_idx
  ON employee.hrms_bulk_import_batches (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS employee.hrms_bulk_import_rows (
  message_id  uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  batch_id    uuid NOT NULL REFERENCES employee.hrms_bulk_import_batches (id) ON DELETE CASCADE,
  row_no      integer NOT NULL,
  employee_no varchar(32) NOT NULL,
  status      varchar(16) NOT NULL DEFAULT 'pending',
  error_code  varchar(64),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_bulk_import_rows_status_check CHECK (status IN ('pending', 'created', 'failed')),
  CONSTRAINT hrms_bulk_import_rows_row_no_check CHECK (row_no > 0),
  CONSTRAINT hrms_bulk_import_rows_batch_row_uq UNIQUE (batch_id, row_no)
);

CREATE INDEX IF NOT EXISTS hrms_bulk_import_rows_batch_idx
  ON employee.hrms_bulk_import_rows (tenant_id, batch_id, status);

ALTER TABLE employee.hrms_bulk_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_bulk_import_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_bulk_import_batches_tenant_isolation ON employee.hrms_bulk_import_batches;
CREATE POLICY hrms_bulk_import_batches_tenant_isolation ON employee.hrms_bulk_import_batches
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE employee.hrms_bulk_import_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee.hrms_bulk_import_rows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hrms_bulk_import_rows_tenant_isolation ON employee.hrms_bulk_import_rows;
CREATE POLICY hrms_bulk_import_rows_tenant_isolation ON employee.hrms_bulk_import_rows
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE ON employee.hrms_bulk_import_batches TO hrms_svc;
GRANT SELECT, INSERT, UPDATE ON employee.hrms_bulk_import_rows TO hrms_svc;
