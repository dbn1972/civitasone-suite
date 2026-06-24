-- Iter1: 7th CPC Dearness Allowance rate table (effective-dated, basis points).
CREATE TABLE IF NOT EXISTS payroll.dearness_allowance_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  effective_from date NOT NULL,
  rate_bps       integer NOT NULL,           -- 5000 = 50.00%
  order_ref      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, effective_from)
);
-- Seed current DA = 50% effective 2026-01-01 for the demo tenant.
INSERT INTO payroll.dearness_allowance_rates (tenant_id, effective_from, rate_bps, order_ref)
VALUES ('00000000-0000-0000-0000-000000000001', '2026-01-01', 5000, 'MoF OM (seed)')
ON CONFLICT (tenant_id, effective_from) DO NOTHING;
