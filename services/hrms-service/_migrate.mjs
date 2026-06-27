import postgres from "postgres";
const url = process.env.DATABASE_URL || "postgres://civitas_admin:civitas_dev_pw@localhost:5435/civitas_hrms";
const sql = postgres(url, { max: 1 });
await sql.unsafe(`
ALTER TABLE recruitment.hrms_job_openings ADD COLUMN IF NOT EXISTS vacancy_type varchar(24) NOT NULL DEFAULT 'regular';
ALTER TABLE recruitment.hrms_job_openings ADD COLUMN IF NOT EXISTS location varchar(200);
ALTER TABLE recruitment.hrms_job_openings ADD COLUMN IF NOT EXISTS qualification varchar(500);
ALTER TABLE recruitment.hrms_job_openings ADD COLUMN IF NOT EXISTS pay_range varchar(120);
ALTER TABLE recruitment.hrms_job_openings ADD COLUMN IF NOT EXISTS is_published varchar(5) NOT NULL DEFAULT 'false';
ALTER TABLE recruitment.hrms_applications ADD COLUMN IF NOT EXISTS resume_file_key text;
ALTER TABLE recruitment.hrms_applications ADD COLUMN IF NOT EXISTS skills text[];
ALTER TABLE recruitment.hrms_applications ADD COLUMN IF NOT EXISTS qualification varchar(500);
ALTER TABLE recruitment.hrms_applications ADD COLUMN IF NOT EXISTS experience_years integer;
ALTER TABLE recruitment.hrms_applications ADD COLUMN IF NOT EXISTS source varchar(32) NOT NULL DEFAULT 'internal';
`);
console.log("migration applied");
await sql.end();
