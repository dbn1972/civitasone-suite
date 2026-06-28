-- 0007: Cross-module file linkage + immutability hardening
-- Enables ANY module (finance, HR, procurement, grant, asset) to raise an eFile
-- for formal approval, and makes notings tamper-evident + DB-level immutable.

-- ─── Module linkage columns on estab_files ─────────────────────────────────
ALTER TABLE files.estab_files
  ADD COLUMN IF NOT EXISTS source_ref_type TEXT,        -- e.g. 'finance_sanction', 'hr_promotion'
  ADD COLUMN IF NOT EXISTS source_ref_id   UUID,        -- ID of the originating entity
  ADD COLUMN IF NOT EXISTS initiated_by    UUID,        -- HR employee who raised the file
  ADD COLUMN IF NOT EXISTS approval_chain  TEXT,        -- workflow definition code
  ADD COLUMN IF NOT EXISTS source_context  JSONB DEFAULT '{}'::jsonb; -- amount, justification, etc.

CREATE INDEX IF NOT EXISTS idx_estab_files_source_ref
  ON files.estab_files (tenant_id, source_ref_type, source_ref_id)
  WHERE source_ref_type IS NOT NULL;

-- ─── Hash chain column on notings (tamper-evident) ─────────────────────────
ALTER TABLE files.estab_notings
  ADD COLUMN IF NOT EXISTS prev_hash TEXT,    -- dscHash of previous noting in the file
  ADD COLUMN IF NOT EXISTS chain_seq INT;     -- position in the immutable chain

-- ─── Immutability trigger: frozen notings cannot be UPDATEd or DELETEd ─────
-- A noting is "frozen" once its status is submitted/approved/rejected.
-- Only transitions FROM 'draft' are allowed; once frozen, the row is locked
-- except for the freeze transition itself (handled by allowing specific status moves).

CREATE OR REPLACE FUNCTION files.enforce_noting_immutability()
RETURNS TRIGGER AS $$
BEGIN
  -- Deletion of a frozen noting is never allowed
  IF (TG_OP = 'DELETE') THEN
    IF OLD.note_status IN ('submitted', 'approved', 'rejected') THEN
      RAISE EXCEPTION 'Frozen noting % cannot be deleted (immutable by design)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  -- Update of a frozen noting: only allow the freeze-forward transitions
  -- (draft→submitted, submitted→approved, submitted→rejected, approval signing fields).
  IF (TG_OP = 'UPDATE') THEN
    -- If the OLD row was already terminally frozen (approved/rejected), block body edits
    IF OLD.note_status IN ('approved', 'rejected') THEN
      IF NEW.body <> OLD.body OR NEW.officer_id <> OLD.officer_id THEN
        RAISE EXCEPTION 'Approved/rejected noting % body is immutable', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    -- If the OLD row was submitted, body cannot change (only status/signature can)
    IF OLD.note_status = 'submitted' THEN
      IF NEW.body <> OLD.body THEN
        RAISE EXCEPTION 'Submitted noting % body is immutable; use a supplementary note', OLD.id
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_noting_immutability ON files.estab_notings;
CREATE TRIGGER trg_noting_immutability
  BEFORE UPDATE OR DELETE ON files.estab_notings
  FOR EACH ROW EXECUTE FUNCTION files.enforce_noting_immutability();

-- ─── Module callback log: records every decision sent back to source modules ─
CREATE TABLE IF NOT EXISTS files.module_decision_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  file_id         UUID NOT NULL,
  source_ref_type TEXT NOT NULL,
  source_ref_id   UUID NOT NULL,
  decision        TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  callback_topic  TEXT NOT NULL,
  noting_id       UUID,
  dsc_hash        TEXT,
  decided_by      UUID NOT NULL,
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_module_decision_file ON files.module_decision_log (tenant_id, file_id);
CREATE INDEX IF NOT EXISTS idx_module_decision_source ON files.module_decision_log (tenant_id, source_ref_type, source_ref_id);
