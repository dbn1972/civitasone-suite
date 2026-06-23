ALTER TABLE hearings.legal_hearings
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_to UUID;
