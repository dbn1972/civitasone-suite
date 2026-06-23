CREATE TABLE IF NOT EXISTS lifecycle.physical_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  verification_date DATE NOT NULL,
  verified_by UUID NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  committee_members JSONB DEFAULT '[]',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lifecycle.physical_verification_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id UUID NOT NULL REFERENCES lifecycle.physical_verifications(id),
  asset_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  condition VARCHAR(20) NOT NULL,
  found_at_location BOOLEAN DEFAULT true,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lifecycle.writeoff_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  asset_id UUID NOT NULL,
  requested_by UUID NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  committee_remarks TEXT,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_writeoff_approvals_asset ON lifecycle.writeoff_approvals(tenant_id, asset_id, status);
