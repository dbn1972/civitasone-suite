-- SEC-009: RLS ENABLE without FORCE on service-owned tables.
-- estab_svc owns consumables.items/transactions (0041_consumables.sql); the
-- owning role silently bypasses its own rls_consumable_* policies without
-- FORCE. See packages/db/src/tenant-scope.ts:20.
-- Rollback (per table): ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY;

ALTER TABLE consumables.items        FORCE ROW LEVEL SECURITY;
ALTER TABLE consumables.transactions FORCE ROW LEVEL SECURITY;
