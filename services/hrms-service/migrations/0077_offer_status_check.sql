-- 0077_offer_status_check.sql
-- The pre-existing hrms_offers_status_check allowed only {draft, sent} — the
-- legacy async offer statuses — so it rejected EVERY status in the new offer
-- lifecycle added in #242 (pending_approval/approved/released/accepted/…) the
-- moment an offer was submitted. Caught by the live smoke. Expand the CHECK to
-- the full lifecycle set; legacy 'sent' is retained. Idempotent.
ALTER TABLE recruitment.hrms_offers DROP CONSTRAINT IF EXISTS hrms_offers_status_check;
ALTER TABLE recruitment.hrms_offers ADD CONSTRAINT hrms_offers_status_check
  CHECK (status IN (
    'draft','sent','pending_approval','returned','approved','released',
    'accepted','declined','withdrawn','expired','revised'
  ));
