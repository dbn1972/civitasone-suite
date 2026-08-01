-- Migration: 0015_reservation_release_qc_status.sql
-- Purpose: Wire the SVC-053/SVC-054 write path (reservation release + goods
--          return QC inspection) that was previously published into the void
--          (no consumer). The application layer already speaks these values:
--            - repo.releaseReservation() sets reservations.status = 'released'
--            - qcInspectionBody allows qcStatus = 'conditional'
--            - qcInspectionBody allows disposition = 'quarantine'
--          but the CHECK constraints from 0012 never included them, so any
--          attempt to persist these transitions would fail at the DB. Additive
--          + idempotent: widens the existing CHECK constraints only.
-- Rollback: re-add each CHECK without the added value (only if no rows use it).
--   ALTER TABLE inventory.reservations DROP CONSTRAINT IF EXISTS chk_reservation_status;
--   ALTER TABLE inventory.reservations ADD CONSTRAINT chk_reservation_status
--     CHECK (status IN ('active', 'fulfilled', 'cancelled', 'expired'));
--   ALTER TABLE inventory.goods_returns DROP CONSTRAINT IF EXISTS chk_goods_returns_qc_status;
--   ALTER TABLE inventory.goods_returns ADD CONSTRAINT chk_goods_returns_qc_status
--     CHECK (qc_status IN ('pending', 'passed', 'failed'));
--   ALTER TABLE inventory.goods_returns DROP CONSTRAINT IF EXISTS chk_goods_returns_disposition;
--   ALTER TABLE inventory.goods_returns ADD CONSTRAINT chk_goods_returns_disposition
--     CHECK (disposition IN ('pending', 'restock', 'scrap', 'return_to_vendor'));
-- Affected services: inventory-service
-- Requirements: SVC-053, SVC-054

SET lock_timeout = '5s';

ALTER TABLE inventory.reservations DROP CONSTRAINT IF EXISTS chk_reservation_status;
ALTER TABLE inventory.reservations ADD CONSTRAINT chk_reservation_status
  CHECK (status IN ('active', 'fulfilled', 'cancelled', 'expired', 'released'));

ALTER TABLE inventory.goods_returns DROP CONSTRAINT IF EXISTS chk_goods_returns_qc_status;
ALTER TABLE inventory.goods_returns ADD CONSTRAINT chk_goods_returns_qc_status
  CHECK (qc_status IN ('pending', 'passed', 'failed', 'conditional'));

ALTER TABLE inventory.goods_returns DROP CONSTRAINT IF EXISTS chk_goods_returns_disposition;
ALTER TABLE inventory.goods_returns ADD CONSTRAINT chk_goods_returns_disposition
  CHECK (disposition IN ('pending', 'restock', 'scrap', 'return_to_vendor', 'quarantine'));
