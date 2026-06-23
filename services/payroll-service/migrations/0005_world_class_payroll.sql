-- Arrears Calculation
CREATE TABLE IF NOT EXISTS payroll.payroll_arrears (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, employee_id UUID NOT NULL, run_id UUID, component_code VARCHAR(32) NOT NULL, from_period VARCHAR(7) NOT NULL, to_period VARCHAR(7) NOT NULL, old_amount_minor BIGINT NOT NULL, new_amount_minor BIGINT NOT NULL, difference_minor BIGINT NOT NULL, reason VARCHAR(256), status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','rejected')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by UUID NOT NULL);

-- Bonus (Payment of Bonus Act)
CREATE TABLE IF NOT EXISTS payroll.payroll_bonus (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, employee_id UUID NOT NULL, fy VARCHAR(7) NOT NULL, basic_minor BIGINT NOT NULL, bonus_pct NUMERIC(5,2) NOT NULL DEFAULT 8.33, bonus_amount_minor BIGINT NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'computed' CHECK (status IN ('computed','approved','paid')), paid_in_run_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

-- Professional Tax (state-wise slabs)
CREATE TABLE IF NOT EXISTS payroll.payroll_professional_tax (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, state_code VARCHAR(4) NOT NULL, slab_from_minor BIGINT NOT NULL, slab_to_minor BIGINT NOT NULL DEFAULT 999999999999, pt_amount_minor BIGINT NOT NULL, effective_from DATE NOT NULL DEFAULT '2024-04-01', is_active BOOLEAN NOT NULL DEFAULT TRUE, UNIQUE(tenant_id, state_code, slab_from_minor));
-- Seed Karnataka PT slabs
INSERT INTO payroll.payroll_professional_tax (tenant_id,state_code,slab_from_minor,slab_to_minor,pt_amount_minor) VALUES ('00000000-0000-0000-0000-000000000001','KA',0,1500000,0),('00000000-0000-0000-0000-000000000001','KA',1500001,999999999999,20000) ON CONFLICT DO NOTHING;

-- Labour Welfare Fund
CREATE TABLE IF NOT EXISTS payroll.payroll_lwf (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, state_code VARCHAR(4) NOT NULL, employee_contrib_minor BIGINT NOT NULL DEFAULT 0, employer_contrib_minor BIGINT NOT NULL DEFAULT 0, frequency VARCHAR(16) NOT NULL DEFAULT 'half_yearly', effective_from DATE NOT NULL DEFAULT '2024-04-01', UNIQUE(tenant_id, state_code));
INSERT INTO payroll.payroll_lwf (tenant_id,state_code,employee_contrib_minor,employer_contrib_minor,frequency) VALUES ('00000000-0000-0000-0000-000000000001','KA',2000,2000,'yearly') ON CONFLICT DO NOTHING;

-- Reimbursements
CREATE TABLE IF NOT EXISTS payroll.payroll_reimbursements (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, employee_id UUID NOT NULL, category VARCHAR(32) NOT NULL CHECK (category IN ('medical','travel','lta','food','telephone','internet','fuel','other')), amount_minor BIGINT NOT NULL, bill_date DATE, bill_ref VARCHAR(128), period VARCHAR(7) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','paid','rejected')), approved_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by UUID NOT NULL);

-- Salary Revision History
CREATE TABLE IF NOT EXISTS payroll.payroll_salary_revisions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, employee_id UUID NOT NULL, effective_date DATE NOT NULL, old_basic_minor BIGINT NOT NULL, new_basic_minor BIGINT NOT NULL, old_gross_minor BIGINT NOT NULL, new_gross_minor BIGINT NOT NULL, revision_type VARCHAR(32) NOT NULL DEFAULT 'annual_increment' CHECK (revision_type IN ('annual_increment','promotion','special','pay_commission','market_correction')), order_no VARCHAR(64), approved_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

-- Payroll Register
CREATE TABLE IF NOT EXISTS payroll.payroll_register (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, run_id UUID NOT NULL, department_id UUID, department_name VARCHAR(128), employee_count INT NOT NULL DEFAULT 0, total_gross_minor BIGINT NOT NULL DEFAULT 0, total_deductions_minor BIGINT NOT NULL DEFAULT 0, total_net_minor BIGINT NOT NULL DEFAULT 0, total_pf_minor BIGINT NOT NULL DEFAULT 0, total_esi_minor BIGINT NOT NULL DEFAULT 0, total_tds_minor BIGINT NOT NULL DEFAULT 0, total_pt_minor BIGINT NOT NULL DEFAULT 0, period VARCHAR(7) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());

-- CTC Calculator Config
CREATE TABLE IF NOT EXISTS payroll.payroll_ctc_config (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL, component_code VARCHAR(32) NOT NULL, component_name VARCHAR(128) NOT NULL, calc_type VARCHAR(16) NOT NULL DEFAULT 'pct_of_basic' CHECK (calc_type IN ('pct_of_basic','pct_of_ctc','fixed','formula')), value NUMERIC(10,4) NOT NULL, is_employer_cost BOOLEAN NOT NULL DEFAULT FALSE, is_active BOOLEAN NOT NULL DEFAULT TRUE, UNIQUE(tenant_id, component_code));
INSERT INTO payroll.payroll_ctc_config (tenant_id,component_code,component_name,calc_type,value,is_employer_cost) VALUES
('00000000-0000-0000-0000-000000000001','BASIC','Basic Salary','pct_of_ctc',40.0000,false),
('00000000-0000-0000-0000-000000000001','HRA','House Rent Allowance','pct_of_basic',50.0000,false),
('00000000-0000-0000-0000-000000000001','DA','Dearness Allowance','pct_of_basic',17.0000,false),
('00000000-0000-0000-0000-000000000001','SA','Special Allowance','pct_of_ctc',10.0000,false),
('00000000-0000-0000-0000-000000000001','ER_PF','Employer PF','pct_of_basic',12.0000,true),
('00000000-0000-0000-0000-000000000001','ER_ESI','Employer ESI','pct_of_basic',3.2500,true)
ON CONFLICT DO NOTHING;
