import postgres from "postgres";
const url = process.env.DATABASE_URL || "postgres://civitas_admin:civitas_dev_pw@localhost:5435/civitas_finance";
const sql = postgres(url, { max: 1 });
await sql.unsafe(`
CREATE TABLE IF NOT EXISTS gl.finance_fiscal_years (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  code varchar(9) NOT NULL, label varchar(64) NOT NULL,
  start_date date NOT NULL, end_date date NOT NULL,
  status varchar(12) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1, UNIQUE (tenant_id, code)
);
CREATE TABLE IF NOT EXISTS gl.finance_opening_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  fy_code varchar(9) NOT NULL, account_code varchar(20) NOT NULL,
  debit_minor bigint NOT NULL DEFAULT 0, credit_minor bigint NOT NULL DEFAULT 0,
  narration text, entered_at timestamptz NOT NULL DEFAULT now(),
  entered_by uuid NOT NULL, version integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, fy_code, account_code)
);
CREATE TABLE IF NOT EXISTS payments.finance_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  bank_name varchar(200) NOT NULL, branch_name varchar(200),
  account_no varchar(30) NOT NULL, ifsc varchar(11) NOT NULL,
  account_type varchar(20) NOT NULL DEFAULT 'current',
  purpose varchar(64), status varchar(12) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
  version integer NOT NULL DEFAULT 1
);
`);
console.log("FY + bank tables created");
await sql.end();
