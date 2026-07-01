import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL || "postgres://civitas_admin:civitas_dev_pw@localhost:5435/civitas_hrms", { max: 1 });
await sql.unsafe(`
CREATE TABLE IF NOT EXISTS employee.hrms_employee_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, code varchar(24) NOT NULL, name varchar(120) NOT NULL,
  description varchar(500), eligible_for_leave boolean NOT NULL DEFAULT true,
  eligible_for_payroll boolean NOT NULL DEFAULT true, eligible_for_appraisal boolean NOT NULL DEFAULT true,
  default_probation_months integer NOT NULL DEFAULT 0, max_contract_months integer,
  pay_mode varchar(16) NOT NULL DEFAULT 'monthly', is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code)
);
`);
console.log("employee_types table created");
await sql.end();
