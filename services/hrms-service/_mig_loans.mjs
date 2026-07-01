import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL || "postgres://civitas_admin:civitas_dev_pw@localhost:5435/civitas_hrms", { max: 1 });
await sql.unsafe(`
CREATE TABLE IF NOT EXISTS employee.hrms_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL, loan_type varchar(32) NOT NULL,
  sanctioned_amount_minor bigint NOT NULL DEFAULT 0, disbursed_amount_minor bigint NOT NULL DEFAULT 0,
  outstanding_minor bigint NOT NULL DEFAULT 0, interest_rate_bps integer NOT NULL DEFAULT 0,
  emi_minor bigint NOT NULL DEFAULT 0, total_emis integer NOT NULL DEFAULT 0,
  emis_paid integer NOT NULL DEFAULT 0, sanction_date date NOT NULL,
  first_emi_date date, last_emi_date date, purpose text,
  status varchar(16) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, version integer NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS employee.hrms_salary_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL, amount_minor bigint NOT NULL DEFAULT 0,
  purpose varchar(200) NOT NULL, recovery_months integer NOT NULL DEFAULT 1,
  emi_minor bigint NOT NULL DEFAULT 0, recovered_minor bigint NOT NULL DEFAULT 0,
  request_date date NOT NULL DEFAULT CURRENT_DATE, approved_by uuid,
  status varchar(16) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL, version integer NOT NULL DEFAULT 1
);
`);
console.log("loans + advances tables created");
await sql.end();
