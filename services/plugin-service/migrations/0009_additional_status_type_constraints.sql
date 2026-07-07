-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: plugin-service

SET lock_timeout = '5s';

-- ============================================================================
-- hooks.plugin_hooks.event_type
-- SKIPPED: event_type is a free-form varchar(128) mirroring arbitrary
-- cross-service/domain event topic names, not a closed catalog owned by this
-- service. validators.ts (registerHookBody) only requires
-- z.string().min(1).max(128); this service's own topics.ts (COMMANDS/EVENTS)
-- lists only plugin-service's own command/event names, not the set of events
-- a plugin can hook into. runtime/engine.ts checks event_type against each
-- individual plugin manifest's own `events` list (or "*"), and
-- runtime/consumer.ts dispatches whatever event_type arrives on the
-- plugin.event.dispatch topic — there is no fixed, service-owned enumeration
-- of valid hook event types; the catalog grows as new producer services
-- and plugin manifests are added. Checked packages/events/src/index.ts for a
-- shared finite topics list — it documents illustrative per-domain event
-- names (identity.user.created, finance.gl_entry.posted, etc.) but is not
-- exhaustive and is not the contract this column validates against. No
-- bounded set could be determined without guessing. Not constrained.
-- ============================================================================
