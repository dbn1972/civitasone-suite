-- 0015: Social Feed — kudos, announcements, travel requests, expense claims, push devices
-- Part of world-class employee app feature set

-- Peer Recognition (Kudos)
CREATE TABLE IF NOT EXISTS hrms.social_kudos (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  giver_id UUID NOT NULL,
  receiver_id UUID NOT NULL,
  giver_name TEXT NOT NULL,
  receiver_name TEXT NOT NULL,
  badge TEXT NOT NULL DEFAULT 'star',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_kudos_tenant_created ON hrms.social_kudos (tenant_id, created_at DESC);
CREATE INDEX idx_kudos_receiver ON hrms.social_kudos (tenant_id, receiver_id);

-- Kudos reactions (likes)
CREATE TABLE IF NOT EXISTS hrms.social_kudos_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kudos_id UUID NOT NULL REFERENCES hrms.social_kudos(id),
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kudos_id, user_id)
);

-- Announcements
CREATE TABLE IF NOT EXISTS hrms.social_announcements (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_by UUID NOT NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX idx_announcements_tenant ON hrms.social_announcements (tenant_id, pinned DESC, created_at DESC);

-- Travel Requests
CREATE TABLE IF NOT EXISTS hrms.travel_requests (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  purpose TEXT NOT NULL,
  destination TEXT NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  advance_required BIGINT NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'rail',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_travel_tenant_employee ON hrms.travel_requests (tenant_id, employee_id, created_at DESC);

-- Expense Claims
CREATE TABLE IF NOT EXISTS hrms.expense_claims (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  category TEXT NOT NULL,
  amount BIGINT NOT NULL, -- paise
  description TEXT NOT NULL DEFAULT '',
  expense_date DATE NOT NULL,
  receipt_key TEXT,
  travel_request_id UUID REFERENCES hrms.travel_requests(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_expenses_tenant_employee ON hrms.expense_claims (tenant_id, employee_id, created_at DESC);

-- Push Notification Device Tokens
CREATE TABLE IF NOT EXISTS hrms.push_devices (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  device_id TEXT NOT NULL,
  token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, device_id)
);
CREATE INDEX idx_push_devices_user ON hrms.push_devices (tenant_id, user_id);
