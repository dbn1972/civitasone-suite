-- Purpose: Workload/availability exclusion (AS-003). Adds on_leave to
--          crm.agent_workload so an agent can be excluded from assignment while
--          on leave, independently of the manual `available` switch. The engine
--          already excludes agents that are unavailable or at/over max_leads;
--          this adds the leave dimension. Full HRMS leave-sync (auto-toggling
--          on_leave from an HRMS event) is a follow-up — this exposes the flag
--          and the exclusion.
-- Rollback: ALTER TABLE crm.agent_workload DROP COLUMN IF EXISTS on_leave;
-- Affected services: crm-service
-- Sequencing: additive column with a default, no rewrite of existing rows'
--             meaning (default false = today's behaviour).

SET lock_timeout = '5s';

ALTER TABLE crm.agent_workload
  ADD COLUMN IF NOT EXISTS on_leave boolean NOT NULL DEFAULT false;
