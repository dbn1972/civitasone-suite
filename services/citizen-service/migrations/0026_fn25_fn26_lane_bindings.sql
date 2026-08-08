-- FN-25/FN-26 — pack-level lane SLA/escalation bindings for USD Phase 2.
-- Stores per-lane SLA days + escalation designation so runtime/sandbox can
-- resolve clocks and escalation recipients without cross-service joins.
SET lock_timeout = '5s';

ALTER TABLE catalogue.service_definitions
  ADD COLUMN IF NOT EXISTS lane_bindings jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN catalogue.service_definitions.lane_bindings IS
  'FN-25: per-lane SLA/escalation bindings [{key,name,slaDays,designationId,escalationDesignationId,...}]';
