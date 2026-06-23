-- Legal: hearing/deadline reminders
CREATE SCHEMA IF NOT EXISTS reminders;

CREATE TABLE IF NOT EXISTS reminders.legal_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  case_id UUID NOT NULL,
  reminder_date DATE NOT NULL,
  reminder_type VARCHAR(32) NOT NULL DEFAULT 'hearing',
  description TEXT,
  is_sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
