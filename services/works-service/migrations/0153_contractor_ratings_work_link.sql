-- Purpose: GAP-WORKS-CONTRACTORS-DETAIL-04 -- optional link from a contractor rating to the work it was earned on.
--          A rating affects tender eligibility, so the officer can now say which work the rating is about instead of
--          only giving free text. Nullable: every existing rating and every rating given without a work stays valid.
--          The route and the consumer validate that a supplied work exists in the caller's tenant; there is
--          deliberately no foreign key (works tables here reference work_proposals by id without one).
-- Rollback:
--   ALTER TABLE works.contractor_ratings DROP COLUMN IF EXISTS work_id;
-- Affected services: works-service

SET lock_timeout = '5s';

ALTER TABLE works.contractor_ratings
  ADD COLUMN IF NOT EXISTS work_id uuid;
