-- Purpose: Add CHECK constraints on all status/type columns to restrict values to defined state machine states
-- Rollback: ALTER TABLE ... DROP CONSTRAINT IF EXISTS <constraint_name> for each constraint below
-- Affected services: telephony-service

SET lock_timeout = '5s';

-- ============================================================================
-- telephony.calls.status
-- Valid states from transitions.ts CALL_STATUSES:
-- queued, ringing, answered, completed, missed, abandoned
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE telephony.calls
    ADD CONSTRAINT calls_status_check
    CHECK (status IN ('queued', 'ringing', 'answered', 'completed', 'missed', 'abandoned'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- telephony.calls.direction
-- Valid values: inbound, outbound
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE telephony.calls
    ADD CONSTRAINT calls_direction_check
    CHECK (direction IN ('inbound', 'outbound'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- telephony.queues.status
-- Valid states: active, inactive, archived
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE telephony.queues
    ADD CONSTRAINT queues_status_check
    CHECK (status IN ('active', 'inactive', 'archived'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- telephony.agents.status
-- Valid states from AGENT_STATUSES: available, busy, wrap_up, offline
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE telephony.agents
    ADD CONSTRAINT agents_status_check
    CHECK (status IN ('available', 'busy', 'wrap_up', 'offline'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE telephony.calls VALIDATE CONSTRAINT calls_status_check;
ALTER TABLE telephony.calls VALIDATE CONSTRAINT calls_direction_check;
ALTER TABLE telephony.queues VALIDATE CONSTRAINT queues_status_check;
ALTER TABLE telephony.agents VALIDATE CONSTRAINT agents_status_check;
