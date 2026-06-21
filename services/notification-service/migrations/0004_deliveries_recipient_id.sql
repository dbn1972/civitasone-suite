-- Add recipient_id (user UUID) to deliveries for per-user inbox scoping.
ALTER TABLE deliveries.deliveries ADD COLUMN IF NOT EXISTS recipient_id uuid;
CREATE INDEX IF NOT EXISTS idx_deliveries_recipient_id ON deliveries.deliveries(recipient_id);
