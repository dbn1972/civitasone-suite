-- Migration 0004: Production readiness for 1000+ employees
-- Adds: holiday calendar, service book, document uploads, reports views

-- ═══ Holiday Calendar ═══
CREATE TABLE IF NOT EXISTS leave.hrms_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name VARCHAR(256) NOT NULL,
  date DATE NOT NULL,
  type VARCHAR(32) NOT NULL DEFAULT 'gazetted' CHECK (type IN ('gazetted', 'restricted', 'optional', 'weekly_off')),
  applicable_to TEXT DEFAULT 'all', -- 'all' or comma-separated department IDs
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,
  UNIQUE(tenant_id, date, name)
);
CREATE INDEX IF NOT EXISTS idx_hrms_holidays_tenant_date ON leave.hrms_holidays(tenant_id, date);

-- ═══ Service Book (Career History) ═══
CREATE TABLE IF NOT EXISTS employee.hrms_service_book (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  event_type VARCHAR(64) NOT NULL CHECK (event_type IN ('joining', 'confirmation', 'promotion', 'transfer', 'deputation', 'repatriation', 'suspension', 'reinstatement', 'pay_revision', 'increment', 'separation')),
  effective_date DATE NOT NULL,
  from_designation VARCHAR(256),
  to_designation VARCHAR(256),
  from_department VARCHAR(256),
  to_department VARCHAR(256),
  from_pay_minor BIGINT,
  to_pay_minor BIGINT,
  order_no VARCHAR(128),
  order_date DATE,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_hrms_service_book_emp ON employee.hrms_service_book(tenant_id, employee_id, effective_date);

-- ═══ Employee Documents ═══
CREATE TABLE IF NOT EXISTS employee.hrms_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  doc_type VARCHAR(64) NOT NULL CHECK (doc_type IN ('photo', 'id_proof', 'address_proof', 'qualification', 'experience', 'medical', 'noc', 'other')),
  file_name VARCHAR(512) NOT NULL,
  file_key VARCHAR(1024) NOT NULL, -- S3/MinIO object key
  file_size_bytes INT NOT NULL DEFAULT 0,
  mime_type VARCHAR(128) NOT NULL DEFAULT 'application/pdf',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by UUID NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_hrms_documents_emp ON employee.hrms_documents(tenant_id, employee_id);

-- ═══ Bulk Import Batches ═══
CREATE TABLE IF NOT EXISTS employee.hrms_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  file_name VARCHAR(512) NOT NULL,
  total_rows INT NOT NULL DEFAULT 0,
  success_count INT NOT NULL DEFAULT 0,
  error_count INT NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_details JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL
);

-- ═══ Seed initial holidays (India 2026) ═══
INSERT INTO leave.hrms_holidays (tenant_id, name, date, type, created_by) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Republic Day', '2026-01-26', 'gazetted', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Holi', '2026-03-17', 'gazetted', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Good Friday', '2026-04-03', 'gazetted', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Independence Day', '2026-08-15', 'gazetted', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Gandhi Jayanti', '2026-10-02', 'gazetted', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Diwali', '2026-10-20', 'gazetted', '00000000-0000-0000-0000-000000000099'),
  ('00000000-0000-0000-0000-000000000001', 'Christmas', '2026-12-25', 'gazetted', '00000000-0000-0000-0000-000000000099')
ON CONFLICT DO NOTHING;

