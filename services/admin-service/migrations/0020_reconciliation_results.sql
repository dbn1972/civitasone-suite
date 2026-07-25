SET lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS admin.reconciliation_results (
  id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
  break_count int NOT NULL DEFAULT 0, matched_count int NOT NULL DEFAULT 0,
  source_system varchar(64) NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin.reconciliation_breaks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL, tenant_id uuid NOT NULL,
  break_type varchar(32) NOT NULL, source_key varchar(256) NOT NULL,
  detail text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_recon_breaks_recon ON admin.reconciliation_breaks (reconciliation_id);
