-- project-service migration 0006: RAG slippage support (P0-2 / P0-4)
-- Run as: project_svc on civitas_project
-- Additive + idempotent. Widens the project & milestone status CHECK constraints to
-- include 'delayed' so the RAG scheduler can persist real slippage state that the
-- dashboard (status = 'delayed') already reads.

ALTER TABLE project.project_projects
  DROP CONSTRAINT IF EXISTS project_projects_status_check;
ALTER TABLE project.project_projects
  ADD CONSTRAINT project_projects_status_check
  CHECK (status IN ('planned','active','on_hold','completed','cancelled','delayed'));

ALTER TABLE project.project_milestones
  DROP CONSTRAINT IF EXISTS project_milestones_status_check;
ALTER TABLE project.project_milestones
  ADD CONSTRAINT project_milestones_status_check
  CHECK (status IN ('pending','completed','cancelled','delayed'));
