CREATE TABLE IF NOT EXISTS entry.stock_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  item_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  entry_id UUID,
  quantity INTEGER NOT NULL,
  remaining_qty INTEGER NOT NULL,
  unit_cost_minor BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_receipts_fifo
  ON entry.stock_receipts (tenant_id, item_id, warehouse_id, created_at)
  WHERE remaining_qty > 0;
