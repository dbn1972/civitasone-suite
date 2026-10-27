-- GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-01 (UAT B4): let a quarter be 'allotted'.
-- The quarters consumer marks the quarter 'allotted' when an allotment is approved (and returns it to
-- 'vacant' on cancel / vacate), but chk_quarter_status (0035) only admitted
-- vacant / occupied / under_maintenance / condemned. Every allot therefore died on the CHECK, rolled
-- back, and (the consumer swallows errors) the officer saw nothing change.
-- Widens the CHECK only; no data changes. Idempotent. Rollback:
--   ALTER TABLE quarters.estab_quarters DROP CONSTRAINT IF EXISTS chk_quarter_status;
--   ALTER TABLE quarters.estab_quarters ADD CONSTRAINT chk_quarter_status
--     CHECK (status IN ('vacant','occupied','under_maintenance','condemned'));
--   (only after no quarter is 'allotted')
ALTER TABLE quarters.estab_quarters DROP CONSTRAINT IF EXISTS chk_quarter_status;
ALTER TABLE quarters.estab_quarters
  ADD CONSTRAINT chk_quarter_status CHECK (status IN ('vacant','allotted','occupied','under_maintenance','condemned'));
