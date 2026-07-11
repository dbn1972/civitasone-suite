-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: 0007_court_order_issuance.sql
-- Service:   court-service (gateway /api/v1/courts) — DB civitas_court
--
-- Purpose:
--   Adds the ORDER-ISSUANCE workflow columns to the existing court.orders table
--   (created in 0001_court_core.sql). The base `order` module records a DRAFT
--   order; this migration layers the maker-checker approval + DSC-pronouncement
--   lifecycle on top of the SAME row:
--
--       draft ──▶ pending_approval ──▶ issued ──▶ recalled
--                        │
--                        └──▶ draft   (sent back for revision)
--
--   Maker-checker / DSC intent (Court spec §23 + §35.5 "AI never auto-issues"):
--     • `status`       — the issuance state (draft|pending_approval|issued|recalled).
--     • `approved_by`  — the CHECKER who approved + issued the order. The application
--                        layer HARD-enforces approved_by ≠ the order's maker
--                        (created_by / signed_by): the person who drafts an order can
--                        never be the person who issues it.
--     • `issued_at`    — the instant of pronouncement (a human, DSC-signed act; the
--                        detached signature lives in the existing dsc_signature TEXT
--                        column). An AI / service actor MUST NEVER issue an order.
--     • `recall_reason`— why an already-issued order was recalled.
--
--   This migration is ADDITIVE and IDEMPOTENT: every column is added with
--   ADD COLUMN IF NOT EXISTS and the index with CREATE INDEX IF NOT EXISTS, so it
--   can be re-applied safely. EXISTING orders.rows default to status 'draft' (the
--   NOT NULL DEFAULT backfills every pre-existing row as a draft awaiting workflow).
--
-- Row-level security (RLS):
--   court.orders ALREADY has BOTH ENABLE + FORCE ROW LEVEL SECURITY and the
--   tenant_isolation policy from 0001_court_core.sql. This migration deliberately
--   does NOT touch RLS — an ALTER TABLE ... ADD COLUMN leaves existing policies and
--   the ENABLE/FORCE flags intact, so tenant isolation continues to apply to the
--   new columns automatically.
--
-- Rollback (DESTRUCTIVE — requires tech-lead / DBA written approval per Migration
--           Safety Rules; no automatic down-migration is provided):
--   ALTER TABLE court.orders
--     DROP COLUMN IF EXISTS status,
--     DROP COLUMN IF EXISTS approved_by,
--     DROP COLUMN IF EXISTS issued_at,
--     DROP COLUMN IF EXISTS recall_reason;
--   DROP INDEX IF EXISTS court.idx_orders_tenant_status;
--
-- Affected services: court-service only (own database, no cross-service tables).
-- ═══════════════════════════════════════════════════════════════════════════════

-- Guard against long lock waits blocking production queries during any ALTER TABLE.
SET lock_timeout = '5s';

-- ── Issuance-workflow columns (idempotent) ──────────────────────────────────────
ALTER TABLE court.orders
    ADD COLUMN IF NOT EXISTS status        VARCHAR(24) NOT NULL DEFAULT 'draft', -- draft|pending_approval|issued|recalled
    ADD COLUMN IF NOT EXISTS approved_by   UUID,                                  -- the checker; app enforces ≠ maker
    ADD COLUMN IF NOT EXISTS issued_at     TIMESTAMPTZ,                           -- pronouncement instant (DSC-signed, human act)
    ADD COLUMN IF NOT EXISTS recall_reason TEXT;

-- ── Read-path index for the approval queue (pending_approval per tenant) ─────────
-- Plain CREATE INDEX (not CONCURRENTLY): safe here because the column is brand-new
-- and every existing row shares the single default value 'draft'. IF NOT EXISTS for
-- idempotent re-runs.
CREATE INDEX IF NOT EXISTS idx_orders_tenant_status
    ON court.orders(tenant_id, status);
