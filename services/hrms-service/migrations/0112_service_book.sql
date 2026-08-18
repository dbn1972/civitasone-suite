CREATE TABLE IF NOT EXISTS lifecycle.hrms_service_book_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  entry_type VARCHAR(30) NOT NULL,
  effective_date DATE NOT NULL,
  description TEXT NOT NULL,
  recorded_by UUID NOT NULL,
  document_ref VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_service_book_employee ON lifecycle.hrms_service_book_entries(employee_id, tenant_id, effective_date);
