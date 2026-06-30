-- 0021: Conditional / partial approval on DFA (gap analysis R10).
-- CSMOP "levels of disposal" — an approving officer may agree, agree with
-- modification (conditional), or partially approve. The decision modality and
-- any conditions become part of the record. Additive + idempotent.

ALTER TABLE files.estab_dfa
  ADD COLUMN IF NOT EXISTS decision_modality   TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS decision_conditions TEXT;

ALTER TABLE files.estab_dfa DROP CONSTRAINT IF EXISTS chk_dfa_decision_modality;
ALTER TABLE files.estab_dfa
  ADD CONSTRAINT chk_dfa_decision_modality CHECK (decision_modality IN
    ('approved','approved_with_conditions','partially_approved'));
