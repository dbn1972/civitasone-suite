-- Purpose: Create missing FK indexes using CREATE INDEX CONCURRENTLY for non-blocking index creation.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS each index listed below.
-- Affected services: project-service only.
-- Safety: IF NOT EXISTS ensures idempotency. CONCURRENTLY avoids table locks.
-- Note: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

SET lock_timeout = '5s';

-- project.project_tasks.parent_task_id (self-referencing FK for WBS hierarchy)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_parent_task_id
  ON project.project_tasks (parent_task_id) WHERE parent_task_id IS NOT NULL;

-- project.project_projects.scheme_id → scheme.project_schemes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_scheme_id
  ON project.project_projects (scheme_id) WHERE scheme_id IS NOT NULL;

-- project.project_members.user_id (FK to user)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_members_user_id
  ON project.project_members (user_id);

-- scheme.project_fund_releases.component_id → scheme.project_scheme_components
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fund_releases_component_id
  ON scheme.project_fund_releases (component_id);

-- utilisation.project_uc_items.uc_statement_id → utilisation.project_uc_statements
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_uc_items_statement_id
  ON utilisation.project_uc_items (uc_statement_id);

-- utilisation.project_uc_items.component_id → scheme.project_scheme_components
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_uc_items_component_id
  ON utilisation.project_uc_items (component_id);

-- geo.project_site_photos.geo_tag_id → geo.project_geo_tags
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_site_photos_geo_tag_id
  ON geo.project_site_photos (geo_tag_id) WHERE geo_tag_id IS NOT NULL;

-- progress.project_physical_progress.component_id (FK to component)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_physical_progress_component_id
  ON progress.project_physical_progress (component_id) WHERE component_id IS NOT NULL;
