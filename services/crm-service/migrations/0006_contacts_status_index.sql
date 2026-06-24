-- crm-service P2-4: partial index supporting the pervasive status<>'deleted'
-- filter on contacts (list/dashboard/detail/find). Additive + idempotent.
-- Indexing only the live rows keeps it small; soft-deleted rows are excluded.
CREATE INDEX IF NOT EXISTS idx_contacts_active
  ON crm.contacts (tenant_id)
  WHERE status <> 'deleted';

-- Mirror for deals, which now also carry a soft-delete status (P1-1).
CREATE INDEX IF NOT EXISTS idx_deals_active
  ON crm.deals (tenant_id)
  WHERE status <> 'deleted';
