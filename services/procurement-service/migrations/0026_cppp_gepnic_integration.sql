-- Migration: 0026_cppp_gepnic_integration.sql
-- Purpose: SVC-050 CPPP + GePNIC e-procurement integration. Widen the shared
--          procurement.gem_integration_refs exchange/reconciliation table to
--          also carry CPPP and GePNIC providers plus award/bid entity types,
--          so the honest env-gated status machine + reconciliation covers all
--          three portals through one tenant-scoped, RLS-enforced table.
-- Additive + idempotent. Safe to re-run. No data rewrite.
-- Rollback: restore the prior CHECK constraints (gem/cppp; tender/order/aoc).
-- Affected services: procurement-service (gem/cppp/gepnic modules)
-- Requirements: SVC-050

BEGIN;

SET lock_timeout = '5s';

-- Widen provider CHECK to include gepnic (gem + cppp already allowed).
ALTER TABLE procurement.gem_integration_refs
  DROP CONSTRAINT IF EXISTS gem_integration_refs_provider_check;
ALTER TABLE procurement.gem_integration_refs
  ADD CONSTRAINT gem_integration_refs_provider_check
  CHECK (provider IN ('gem', 'cppp', 'gepnic'));

-- Widen entity_type CHECK to include award + bid (for CPPP bid-status and
-- GePNIC award-of-contract reconciliation), keeping tender/order/aoc.
ALTER TABLE procurement.gem_integration_refs
  DROP CONSTRAINT IF EXISTS gem_integration_refs_entity_type_check;
ALTER TABLE procurement.gem_integration_refs
  ADD CONSTRAINT gem_integration_refs_entity_type_check
  CHECK (entity_type IN ('tender', 'order', 'aoc', 'award', 'bid'));

-- Provider column stays VARCHAR(8); 'gepnic' (6 chars) fits.
-- RLS (ENABLE + FORCE + tenant_isolation policy) already applied in 0025 and
-- is unchanged here — the widened table remains fail-closed tenant-isolated.

COMMIT;
