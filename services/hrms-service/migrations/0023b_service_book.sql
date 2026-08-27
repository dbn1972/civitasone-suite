-- Renumbered 2026-08-27: originally 0112_service_book.sql. 0024's own
-- section 2 (service-book attestation) ALTERs this table, and
-- 0034/0035/0038 also reference it — all sort earlier than 112 ever did.
-- Moved to the smallest slot that sorts before its earliest consumer
-- (0024) so the whole chain resolves on a fresh cluster. Content unchanged.
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
