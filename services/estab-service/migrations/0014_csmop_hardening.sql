-- estab-service: CSMOP hardening — gapless file numbering, note designation
-- snapshot, system dispatch numbering + delivery, richer receipt diary.
-- Additive, idempotent, forward-only.

-- ── Gapless per-(tenant, section, year) document sequence (files + dispatch) ──
CREATE TABLE IF NOT EXISTS files.estab_doc_seq (
  tenant_id  uuid    NOT NULL,
  series     text    NOT NULL,        -- 'file:<section>' or 'dispatch'
  year       integer NOT NULL,
  last_seq   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, series, year)
);

-- ── CSMOP: each note freezes the author's name/designation/section ──
ALTER TABLE files.estab_notings
  ADD COLUMN IF NOT EXISTS officer_name        text,
  ADD COLUMN IF NOT EXISTS officer_designation text,
  ADD COLUMN IF NOT EXISTS officer_section     text;

-- ── Dispatch: system-generated number + delivery proof/status ──
ALTER TABLE files.estab_dispatch
  ADD COLUMN IF NOT EXISTS delivery_status varchar(24) NOT NULL DEFAULT 'pending', -- pending|sent|delivered|returned|failed
  ADD COLUMN IF NOT EXISTS delivered_at    timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_proof  text;

-- ── Receipt/DAK diary: full CSMOP metadata ──
ALTER TABLE files.estab_inward
  ADD COLUMN IF NOT EXISTS mode          varchar(24),   -- post|email|fax|hand|portal|courier
  ADD COLUMN IF NOT EXISTS language      varchar(24),
  ADD COLUMN IF NOT EXISTS urgency       varchar(16),   -- normal|urgent|immediate
  ADD COLUMN IF NOT EXISTS category      varchar(32),
  ADD COLUMN IF NOT EXISTS received_date date,
  ADD COLUMN IF NOT EXISTS due_date      date,
  ADD COLUMN IF NOT EXISTS detached_reason text,
  ADD COLUMN IF NOT EXISTS detached_at   timestamptz;

-- ── Receipt movement history ──
CREATE TABLE IF NOT EXISTS files.estab_inward_movements (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  inward_id    uuid        NOT NULL,
  from_officer uuid,
  to_officer   uuid,
  action       varchar(24) NOT NULL,
  remarks      text,
  moved_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_estab_inward_movements ON files.estab_inward_movements (tenant_id, inward_id);
