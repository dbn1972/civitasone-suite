-- 0053_disbursement_transfers.sql
-- GAP-PAYROLL-DISBURSEMENT-TRANSFERS: per-employee transfer ledger behind the
-- /hr/payroll/disbursement "Employee Bank Transfers" card (PR #1757), which
-- calls GET /v1/payroll/disbursement/transfers and
-- POST /v1/payroll/disbursement/transfers/:id/retry -- neither existed, and
-- there was no transfer-status data anywhere.
--
-- One row per employee payment line actually placed in a bank file:
--   * POST /v1/payroll/runs/:id/bank-file writes, in ONE transaction under a
--     per-run advisory lock: a disbursement_file_issuances row, the ledger
--     rows for exactly the lines in that file, and the audit outbox row --
--     before the file is returned. The first file of a run carries every
--     payable slip (attempt-1 "root" rows); later files carry only employees
--     never sent plus queued retries, unless an admin explicitly asks for an
--     audited full re-issue (which records a new attempt per duplicated line).
--   * a retry inserts attempt N+1 with parent_transfer_id = the failed/returned
--     row (status 'pending'); the next bank file for the run carries it. One
--     child per parent (unique index) so a double-click can never create two
--     attempts.
--   * NACH return files are recorded once per (tenant, run, content hash) in
--     nach_return_files and settle only rows of the file they name.
--
-- PII: only the LAST 4 digits of the beneficiary account are stored. The full
-- number stays in the HRMS / pensioner master it is read from.
-- Money: amount_minor is bigint paise.
--
-- Rollback:
--   DROP TABLE IF EXISTS payroll.nach_return_files;
--   DROP TABLE IF EXISTS payroll.disbursement_transfers;
--   DROP TABLE IF EXISTS payroll.disbursement_file_issuances;
SET lock_timeout = '5s';

-- One row per generated bank file (any format). seq numbers the run's files;
-- NACH batch numbers [batch_from, batch_to] are unique within the run so every
-- NACH part file name is distinct and a return file can name the file it
-- answers.
CREATE TABLE IF NOT EXISTS payroll.disbursement_file_issuances (
  id                  uuid PRIMARY KEY,
  tenant_id           uuid NOT NULL,
  run_id              uuid NOT NULL,
  seq                 integer NOT NULL,
  mode                varchar(16) NOT NULL,
  file_format         varchar(8) NOT NULL,
  file_name           text NOT NULL,
  batch_from          integer,
  batch_to            integer,
  line_count          integer NOT NULL,
  total_minor         bigint NOT NULL,
  reason              varchar(500) NOT NULL,
  full_reissue_reason varchar(500),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL,
  CONSTRAINT disbursement_file_issuances_mode_chk CHECK (mode IN ('first', 'incremental', 'full_reissue')),
  CONSTRAINT disbursement_file_issuances_format_chk CHECK (file_format IN ('csv', 'nach', 'apbs')),
  CONSTRAINT disbursement_file_issuances_total_chk CHECK (total_minor >= 0 AND line_count >= 1),
  CONSTRAINT disbursement_file_issuances_full_chk
    CHECK ((mode = 'full_reissue') = (full_reissue_reason IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_disbursement_file_issuances_seq
  ON payroll.disbursement_file_issuances (tenant_id, run_id, seq);
ALTER TABLE payroll.disbursement_file_issuances ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.disbursement_file_issuances FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.disbursement_file_issuances;
CREATE POLICY tenant_isolation_policy ON payroll.disbursement_file_issuances
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

CREATE TABLE IF NOT EXISTS payroll.disbursement_transfers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  run_id             uuid NOT NULL,
  slip_id            uuid,
  employee_id        uuid NOT NULL,
  employee_no        varchar(32) NOT NULL,
  beneficiary_name   text NOT NULL,
  amount_minor       bigint NOT NULL,
  ifsc               varchar(11) NOT NULL,
  account_last4      varchar(4),
  issuance_id        uuid REFERENCES payroll.disbursement_file_issuances(id),
  file_format        varchar(8),
  file_reference     text,
  status             varchar(16) NOT NULL DEFAULT 'pending',
  reason_code        varchar(8),
  reason_text        text,
  attempt_no         integer NOT NULL DEFAULT 1,
  parent_transfer_id uuid REFERENCES payroll.disbursement_transfers(id),
  idempotency_key    varchar(128),
  request_hash       varchar(64),
  request_reason     varchar(500),
  sent_at            timestamptz,
  settled_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  CONSTRAINT disbursement_transfers_status_chk
    CHECK (status IN ('pending', 'sent', 'success', 'failed', 'returned')),
  CONSTRAINT disbursement_transfers_format_chk
    CHECK (file_format IS NULL OR file_format IN ('csv', 'nach', 'apbs')),
  CONSTRAINT disbursement_transfers_amount_chk CHECK (amount_minor >= 0),
  CONSTRAINT disbursement_transfers_last4_chk
    CHECK (account_last4 IS NULL OR account_last4 ~ '^[0-9A-Za-z]{1,4}$'),
  CONSTRAINT disbursement_transfers_attempt_chk CHECK (attempt_no >= 1),
  CONSTRAINT disbursement_transfers_parent_chk
    CHECK ((attempt_no = 1) = (parent_transfer_id IS NULL))
);

-- Re-issue idempotency: exactly one root (attempt 1) row per employee per run.
CREATE UNIQUE INDEX IF NOT EXISTS uq_disbursement_transfers_root
  ON payroll.disbursement_transfers (tenant_id, run_id, employee_id)
  WHERE parent_transfer_id IS NULL;

-- Double-click guard: at most one retry attempt per failed/returned row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_disbursement_transfers_parent
  ON payroll.disbursement_transfers (parent_transfer_id)
  WHERE parent_transfer_id IS NOT NULL;

-- x-idempotency-key: same key -> same retry row, per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_disbursement_transfers_idem
  ON payroll.disbursement_transfers (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_disbursement_transfers_tenant_run_status
  ON payroll.disbursement_transfers (tenant_id, run_id, status);

CREATE INDEX IF NOT EXISTS idx_disbursement_transfers_tenant_run_fileref
  ON payroll.disbursement_transfers (tenant_id, run_id, file_reference);

CREATE INDEX IF NOT EXISTS idx_disbursement_transfers_tenant_created
  ON payroll.disbursement_transfers (tenant_id, created_at DESC, id DESC);

ALTER TABLE payroll.disbursement_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.disbursement_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.disbursement_transfers;
CREATE POLICY tenant_isolation_policy ON payroll.disbursement_transfers
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());

-- NACH return uploads: one row per distinct return file per run. The unique
-- key makes a re-upload of the same file a no-op (the route answers 409 and
-- the consumer skips it), so a stale return can never settle a later retry.
CREATE TABLE IF NOT EXISTS payroll.nach_return_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  run_id          uuid NOT NULL,
  file_hash       char(64) NOT NULL,
  file_reference  text,
  message_id      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_nach_return_files_hash
  ON payroll.nach_return_files (tenant_id, run_id, file_hash);
ALTER TABLE payroll.nach_return_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.nach_return_files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.nach_return_files;
CREATE POLICY tenant_isolation_policy ON payroll.nach_return_files
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
