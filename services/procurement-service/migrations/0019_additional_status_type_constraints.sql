-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: procurement-service

SET lock_timeout = '5s';

-- ============================================================================
-- vendor.procurement_vendors.vendor_type
-- SKIPPED: already has an enforced CHECK constraint, added inline in
-- 0001_init.sql — CHECK (vendor_type IN ('registered','empanelled','blacklisted')).
-- Postgres auto-named that unnamed column CHECK "procurement_vendors_vendor_type_check"
-- (the default {table}_{column}_check naming), so no further action is needed here.
-- ============================================================================

-- ============================================================================
-- vendor.procurement_vendor_docs.doc_type
-- SKIPPED: unbounded/free-form. This column is `text` (no length cap) and has
-- no active read/write code path in vendor/commands.ts, vendor/consumer.ts, or
-- vendor/routes.ts — the table is defined in schema.ts/migrations but never
-- inserted into anywhere in the current codebase. The only guidance is an
-- illustrative comment in 0001_init.sql ("doc_type text NOT NULL, -- pan|gst|
-- msme|empanelment_cert|...") whose trailing "..." explicitly signals an
-- open-ended/non-exhaustive list. Do not guess a closed set for an unused,
-- intentionally open column.
-- ============================================================================

-- ============================================================================
-- po.procurement_po_items.item_type
-- Valid values: consumable, fixed_asset, service
-- (source: modules/po/validators.ts poItemSchema.itemType z.enum; consistent
-- with modules/po/consumer.ts, modules/grn/consumer.ts inferItemType, and the
-- cross-service contract with asset-service/src/modules/register/consumer.ts
-- and stock-service consumers which key off these exact literals)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE po.procurement_po_items
    ADD CONSTRAINT procurement_po_items_item_type_check
    CHECK (item_type IN ('consumable', 'fixed_asset', 'service'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- payments.procurement_advances.advance_type
-- Valid values: mobilisation, material (source: modules/payments/validators.ts
-- createAdvanceBody.advanceType z.enum)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE payments.procurement_advances
    ADD CONSTRAINT procurement_advances_advance_type_check
    CHECK (advance_type IN ('mobilisation', 'material'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE po.procurement_po_items VALIDATE CONSTRAINT procurement_po_items_item_type_check;
ALTER TABLE payments.procurement_advances VALIDATE CONSTRAINT procurement_advances_advance_type_check;
