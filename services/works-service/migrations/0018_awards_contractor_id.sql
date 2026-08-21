-- Purpose: Link works.awards to a structured works.contractors record.
-- Bug fix (works-billing-integrity #4): awards.contractorName was free text
-- with no link to the structured contractor entity created via
-- POST /v1/works/contractors, so the tender → contractor → award chain
-- could not be enforced. Nullable + additive: existing rows are unaffected;
-- application code now requires the cited contractor (by id, or by name for
-- older/legacy callers) to reference an existing works.contractors row
-- before an award can be created.
-- Rollback: ALTER TABLE works.awards DROP COLUMN IF EXISTS contractor_id;
-- Affected services: works-service

SET lock_timeout = '5s';

ALTER TABLE works.awards
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES works.contractors(id);

CREATE INDEX IF NOT EXISTS awards_contractor_id_idx ON works.awards(contractor_id);
