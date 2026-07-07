-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: install-service

SET lock_timeout = '5s';

-- ============================================================================
-- orchestrator.step_definitions.handler_type — SKIPPED, genuinely open-ended.
-- The zod validator (modules/orchestrator/validators.ts stepDefBody) only
-- constrains handlerType to z.string().min(1).max(64) — no enum. Callers of
-- POST /v1/install/wizards (createWizardBody) supply an arbitrary handlerType
-- per step; the orchestrator consumer/domain layer (domain.ts, consumer.ts)
-- treats it as an opaque label for the wizard-step DAG and never branches on
-- specific values — resolveReadySteps/isWizardComplete/computeInitialStatus
-- only inspect dependsOn/isRequired/status, not handlerType. Tests
-- (tests/orchestrator.test.ts) exercise "auto" and "manual" but the API
-- accepts any tenant-supplied handler label for future step types (e.g.
-- per-edition provisioning handlers). No fixed enumeration is enforced or
-- discoverable app-side, so a CHECK would reject legitimate future values.
-- Left unconstrained.
-- ============================================================================

-- No constraints added — see rationale above. Nothing to VALIDATE.
