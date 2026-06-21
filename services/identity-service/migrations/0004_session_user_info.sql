-- identity-service sessions: add user info columns for list view

ALTER TABLE sessions.sessions ADD COLUMN IF NOT EXISTS user_email text NOT NULL DEFAULT '';
ALTER TABLE sessions.sessions ADD COLUMN IF NOT EXISTS user_name  text;
ALTER TABLE sessions.sessions ADD COLUMN IF NOT EXISTS user_agent varchar(512);
ALTER TABLE sessions.sessions ADD COLUMN IF NOT EXISTS last_active_at timestamptz NOT NULL DEFAULT now();
