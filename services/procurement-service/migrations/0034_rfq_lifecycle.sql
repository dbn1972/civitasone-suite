-- 0034_rfq_lifecycle.sql
-- DOM-011 (2/2): real RFQ close/award lifecycle.
--
-- BEFORE this migration, an RFQ could reach exactly one real state:
-- rfq/consumer.ts's registerRfqConsumers() only ever subscribed to
-- COMMANDS.rfqCreate, which inserts the row with status='issued' and never
-- transitions it again -- there was no close/award/cancel command, consumer,
-- or route anywhere. Worse: rfq/commands.ts's respondToRfq() DOES publish
-- COMMANDS.rfqRespond (procurement.rfq.respond), and rfq/routes.ts DOES expose
-- POST /v1/procurement/rfqs/:id/respond to accept it -- but no consumer in
-- the whole repo ever subscribed to that topic (confirmed by repo-wide grep),
-- so a vendor's response was queued and then silently dropped. Nothing was
-- ever persisted for it: rfq/queries.ts's getRfqDetail() hardcoded
-- `responses: []`, and `responses_received` stayed 0 forever after create.
-- An RFQ could not reach "closed" or "awarded" not just because the state
-- machine was missing, but because there was nothing to award -- responses
-- never landed anywhere. This migration adds the storage both problems need.
--
-- rfq.procurement_rfqs.status already carries a CHECK constraint (migration
-- 0015) for exactly ('draft','issued','closed','cancelled','awarded'), and
-- packages/schemas/src/web.ts's RFQDetailSchema/RFQSummarySchema already
-- declare that same 5-value enum plus the exact `responses[]` shape
-- (vendorId/vendorName/totalAmount/submittedAt/status) -- both were already
-- in place, unused, before this fix. The state machine implemented in the
-- accompanying rfq/domain.ts (issued->closed/cancelled, closed->awarded/
-- cancelled) and the SoD check on award (assertDistinctMakerChecker) mirror
-- po/domain.ts and tender/domain.ts exactly, the established convention for
-- every other lifecycle in this service.
--
-- No real FOREIGN KEY constraint on awarded_response_id, matching this
-- service's existing convention for cross-row "winning" pointers (see
-- tender.procurement_tenders.awarded_bid_id / awarded_vendor_id, migration
-- 0018's comments: "FK-style lookup column, no covering index found" --
-- plain column + index, no REFERENCES, throughout this schema).
--
-- Rollback:
--   ALTER TABLE rfq.procurement_rfqs DROP COLUMN IF EXISTS closed_at, DROP COLUMN IF EXISTS awarded_at, DROP COLUMN IF EXISTS awarded_response_id;
--   DROP TABLE IF EXISTS rfq.procurement_rfq_responses;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS rfq.procurement_rfq_responses (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  rfq_id            uuid        NOT NULL,
  vendor_id         uuid        NOT NULL,
  -- Snapshot of the submitted line items (itemId/itemName, unitPrice,
  -- leadTimeDays, notes) exactly as validated by rfq/validators.ts's
  -- rfqRespondBody -- kept denormalized like tender's financial-bid amounts
  -- rather than a separate item-rows table, since a response is immutable
  -- once submitted (no amend/withdraw flow exists for RFQ responses, mirroring
  -- how a tender bid is also never mutated after submission).
  items             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  total_amount_minor bigint     NOT NULL DEFAULT 0,
  valid_until       date,
  terms_accepted    boolean     NOT NULL DEFAULT false,
  remarks           text,
  status            varchar(16) NOT NULL DEFAULT 'submitted',  -- submitted|awarded|rejected
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_by        uuid        NOT NULL,
  version           integer     NOT NULL DEFAULT 1,
  CONSTRAINT procurement_rfq_responses_status_check
    CHECK (status IN ('submitted', 'awarded', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_procurement_rfq_responses_rfq_id
  ON rfq.procurement_rfq_responses (rfq_id);
CREATE INDEX IF NOT EXISTS idx_procurement_rfq_responses_tenant_status
  ON rfq.procurement_rfq_responses (tenant_id, status);
-- One response per vendor per RFQ -- resubmission is out of scope (same as
-- tender bids: submit once, no amend/withdraw flow exists there either).
CREATE UNIQUE INDEX IF NOT EXISTS ux_procurement_rfq_responses_rfq_vendor
  ON rfq.procurement_rfq_responses (rfq_id, vendor_id);

ALTER TABLE rfq.procurement_rfq_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfq.procurement_rfq_responses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON rfq.procurement_rfq_responses;
CREATE POLICY tenant_isolation_policy ON rfq.procurement_rfq_responses
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

-- rfq.procurement_rfqs: close/award timestamps + winning-response pointer.
ALTER TABLE rfq.procurement_rfqs
  ADD COLUMN IF NOT EXISTS closed_at          timestamptz,
  ADD COLUMN IF NOT EXISTS awarded_at         timestamptz,
  ADD COLUMN IF NOT EXISTS awarded_response_id uuid;

CREATE INDEX IF NOT EXISTS idx_procurement_rfqs_awarded_response_id
  ON rfq.procurement_rfqs (awarded_response_id);
