-- DB-M1: Add CHECK constraints to budget status columns.
-- Status values verified against domain files (distribution-domain.ts,
-- supplementary-domain.ts, formulation-domain.ts) before applying.
SET lock_timeout = '5s';

-- finance_budget_distribution: draft|issued|acknowledged|returned
DO $$ BEGIN
  ALTER TABLE budget.finance_budget_distribution
    ADD CONSTRAINT finance_budget_distribution_status_chk
    CHECK (status IN ('draft','issued','acknowledged','returned')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE budget.finance_budget_distribution
    VALIDATE CONSTRAINT finance_budget_distribution_status_chk;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- finance_supplementary: pending_approval|approved|rejected
DO $$ BEGIN
  ALTER TABLE budget.finance_supplementary
    ADD CONSTRAINT finance_supplementary_status_chk
    CHECK (status IN ('pending_approval','approved','rejected')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE budget.finance_supplementary
    VALIDATE CONSTRAINT finance_supplementary_status_chk;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- finance_budget_proposals: draft|submitted|under_review|returned|approved
DO $$ BEGIN
  ALTER TABLE budget.finance_budget_proposals
    ADD CONSTRAINT finance_budget_proposals_status_chk
    CHECK (status IN ('draft','submitted','under_review','returned','approved')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE budget.finance_budget_proposals
    VALIDATE CONSTRAINT finance_budget_proposals_status_chk;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
