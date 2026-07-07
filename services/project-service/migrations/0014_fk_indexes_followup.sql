-- Purpose: Follow-up FK index audit — create remaining missing FK-lookup indexes
--          not covered by the earlier fk_indexes migration, using CREATE INDEX CONCURRENTLY.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: project-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- project.project_members.project_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_members_project_id
  ON project.project_members (project_id);

-- project.milestone_evidence.milestone_id (FK-style lookup column, no covering index found)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_milestone_evidence_milestone_id
  ON project.milestone_evidence (milestone_id);
