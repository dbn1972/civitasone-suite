-- 0018: Digital Visiting Cards
-- Employee business cards with vCard (.vcf) export, QR sharing, email signatures

CREATE TABLE IF NOT EXISTS hrms.visiting_cards (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  -- Display overrides (optional — falls back to employee master)
  display_name TEXT,
  suffix TEXT, -- IAS, PhD, MBBS, etc.
  title_override TEXT, -- custom title instead of designation
  -- Contact details (beyond what's in employee master)
  alt_phone TEXT,
  alt_email TEXT,
  website TEXT,
  linkedin TEXT,
  twitter TEXT,
  address TEXT,
  tagline TEXT, -- e.g. "Digital India Corporation, Ministry of Electronics & IT"
  -- Preferences
  show_personal_phone BOOLEAN NOT NULL DEFAULT false,
  card_tier TEXT NOT NULL DEFAULT 'indigo' CHECK (card_tier IN ('gold', 'silver', 'blue', 'indigo', 'emerald')),
  -- Analytics
  share_count INT NOT NULL DEFAULT 0,
  scan_count INT NOT NULL DEFAULT 0,
  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, employee_id)
);
