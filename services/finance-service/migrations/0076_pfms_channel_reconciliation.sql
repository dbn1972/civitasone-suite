-- PFMS channel reconciliation.
--
-- finance-service has two independent, non-interoperating PFMS submission
-- mechanisms: the file-based/treasury batch path (routes.ts + repo.ts +
-- pfms/consumer.ts + integrations/consumer.ts's SFTP egress -- DSC-signed,
-- SFTP-transmitted, tracked in this very table) and the live e-Kuber REST
-- adapter path (adapter-routes.ts + adapter.ts -- synchronous, circuit-
-- breaker-protected). Both are real, both are wired into app.ts, and both
-- are used from the PFMS Ops Console (apps/web/.../finance/pfms/page.tsx):
-- BatchesPanel/ConfigPanel read the treasury batch path, SubmitPaymentForm/
-- PaymentStatusLookup call the e-Kuber adapter path. They exist for
-- genuinely different scenarios (bulk/scheduled payroll & grant
-- disbursements batched to a NACH file and couriered over SFTP, vs. a
-- one-off/on-demand payment submitted synchronously to e-Kuber) -- see the
-- PR description for the full investigation.
--
-- The e-Kuber adapter made zero DB calls before this migration: a payment
-- submitted through it left no trace discoverable anywhere else in the app.
-- `channel` lets both paths write into the SAME ledger so a single lookup
-- (GET /v1/finance/pfms/batches) answers "was this disbursement actually
-- paid" regardless of which mechanism handled it.
ALTER TABLE payments.finance_pfms
  ADD COLUMN IF NOT EXISTS channel varchar(24) NOT NULL DEFAULT 'treasury_batch';

ALTER TABLE payments.finance_pfms
  DROP CONSTRAINT IF EXISTS chk_finance_pfms_channel;

ALTER TABLE payments.finance_pfms
  ADD CONSTRAINT chk_finance_pfms_channel
  CHECK (channel IN ('treasury_batch', 'ekuber_adapter'));

-- migrations/0036_check_constraints_status_columns.sql locked `type` down to
-- the treasury batch's own three business categories and `submission_status`
-- down to the treasury batch's own four lifecycle stages -- neither leaves
-- room for an e-Kuber adapter row. Extend both (never narrow: every existing
-- allowed value stays valid) rather than force-fitting the e-Kuber vocabulary
-- into an unrelated existing value.
--   type: 'adhoc' for a single on-demand e-Kuber payment (not a
--         salary/grant/scheme batch).
--   submission_status: e-Kuber's own disposition vocabulary (accepted/
--         rejected/processing/completed/failed; 'pending' already allowed).
-- `status` is intentionally left untouched -- adapter rows never set it, so
-- it stays at its column default ('pending', already a valid status value)
-- and finance_pfms_status_check needs no change.
ALTER TABLE payments.finance_pfms
  DROP CONSTRAINT IF EXISTS finance_pfms_type_check;

ALTER TABLE payments.finance_pfms
  ADD CONSTRAINT finance_pfms_type_check
  CHECK (type IN ('salary', 'grant', 'scheme', 'adhoc'));

ALTER TABLE payments.finance_pfms
  DROP CONSTRAINT IF EXISTS finance_pfms_submission_status_check;

ALTER TABLE payments.finance_pfms
  ADD CONSTRAINT finance_pfms_submission_status_check
  CHECK (submission_status IN (
    'pending', 'file_sent', 'signed', 'submitted',
    'accepted', 'rejected', 'processing', 'completed', 'failed'
  ));

-- UTR (bank Unique Transaction Reference) for a completed e-Kuber payment.
-- The treasury/SFTP channel never needed this column -- its UTR lives on
-- payments.finance_payments instead (see pfms/repo.ts's listRealBeneficiaries)
-- -- but the e-Kuber adapter's status-check response carries one directly and
-- finance_pfms had nowhere to put it.
ALTER TABLE payments.finance_pfms
  ADD COLUMN IF NOT EXISTS utr_number text;

-- Every existing row predates the e-Kuber adapter's persistence and is,
-- unambiguously, a treasury-batch row -- the DEFAULT above already backfills
-- it. This index makes the new find-by-(tenant, pfmsId, channel) lookup
-- (repo.ts's upsertAdapterPfmsRecord) an index scan instead of a seq scan.
CREATE INDEX IF NOT EXISTS idx_finance_pfms_tenant_pfmsid_channel
  ON payments.finance_pfms (tenant_id, pfms_id, channel);
