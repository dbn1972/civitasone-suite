-- hrms-service: recruitment vacancy types and public applications.
-- Additive, idempotent, forward-only. Safe to re-run.

-- Vacancy type: regular hire, internship, apprenticeship, contractual, deputation.
ALTER TABLE recruitment.hrms_job_openings
  ADD COLUMN IF NOT EXISTS vacancy_type varchar(24) NOT NULL DEFAULT 'regular';

-- Location/city for the vacancy (helps candidates filter).
ALTER TABLE recruitment.hrms_job_openings
  ADD COLUMN IF NOT EXISTS location varchar(200);

-- Qualification requirement (brief, shown on public board).
ALTER TABLE recruitment.hrms_job_openings
  ADD COLUMN IF NOT EXISTS qualification varchar(500);

-- Pay scale / stipend range (shown on public board).
ALTER TABLE recruitment.hrms_job_openings
  ADD COLUMN IF NOT EXISTS pay_range varchar(120);

-- Is this vacancy published to the public careers page?
ALTER TABLE recruitment.hrms_job_openings
  ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false;

-- Resume storage: file reference (S3 key), parsed skills, searchable text.
ALTER TABLE recruitment.hrms_applications
  ADD COLUMN IF NOT EXISTS resume_file_key text;
ALTER TABLE recruitment.hrms_applications
  ADD COLUMN IF NOT EXISTS skills text[];
ALTER TABLE recruitment.hrms_applications
  ADD COLUMN IF NOT EXISTS qualification varchar(500);
ALTER TABLE recruitment.hrms_applications
  ADD COLUMN IF NOT EXISTS experience_years integer;
ALTER TABLE recruitment.hrms_applications
  ADD COLUMN IF NOT EXISTS source varchar(32) NOT NULL DEFAULT 'internal';

-- Index for the public careers board (published + open vacancies only).
CREATE INDEX IF NOT EXISTS idx_job_openings_published
  ON recruitment.hrms_job_openings(tenant_id, is_published, status);

-- Index for talent pool searches (by tenant + skills).
CREATE INDEX IF NOT EXISTS idx_applications_tenant_skills
  ON recruitment.hrms_applications USING gin(skills);
