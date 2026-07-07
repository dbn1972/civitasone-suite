-- Purpose: Add CHECK constraints on remaining status/type columns lacking them (follow-up to prior status-column migration)
-- Rollback: DROP each CHECK constraint by name (ALTER TABLE ... DROP CONSTRAINT IF EXISTS ...)
-- Affected services: stock-service

SET lock_timeout = '5s';

-- ============================================================================
-- item.stock_item_categories.item_type
-- Valid values: consumable, fixed_asset, service
-- (no dedicated insert/validator path exists for this table today — it has
-- no commands.ts/consumer.ts writer in modules/item — but this column shares
-- the exact name/purpose with item.stock_items.item_type directly below it in
-- the same schema.ts, which IS validated by modules/item/validators.ts
-- createItemBody.itemType z.enum(["consumable","fixed_asset","service"]).
-- Applying the same closed set here for consistency across the two sibling
-- item-classification columns in the same module.)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE item.stock_item_categories
    ADD CONSTRAINT stock_item_categories_item_type_check
    CHECK (item_type IN ('consumable', 'fixed_asset', 'service'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- item.stock_items.item_type
-- Valid values: consumable, fixed_asset, service (source:
-- modules/item/validators.ts createItemBody.itemType z.enum; consistent with
-- modules/item/consumer.ts default and modules/entry/consumer.ts's
-- itemType !== "fixed_asset" check)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE item.stock_items
    ADD CONSTRAINT stock_items_item_type_check
    CHECK (item_type IN ('consumable', 'fixed_asset', 'service'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- ledger.stock_ledger.voucher_type
-- Valid values: receipt, issue, transfer_out, transfer_in, adjustment
-- (source: modules/entry/domain.ts voucherTypeForEntry() — exhaustive switch
-- over EntryType with the transfer case split by side; confirmed by literal
-- writes in modules/entry/consumer.ts and a read-side comparison in
-- modules/dashboard/queries.ts)
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE ledger.stock_ledger
    ADD CONSTRAINT stock_ledger_voucher_type_check
    CHECK (voucher_type IN ('receipt', 'issue', 'transfer_out', 'transfer_in', 'adjustment'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- eway_bill.eway_bills.supply_type
-- Valid values: outward, inward (source: modules/eway-bill/validators.ts
-- createEwayBillBody.supplyType z.enum). Note: the DB stores these
-- descriptive strings, not the government's raw "O"/"I" short codes — the
-- O/I mapping happens only at the outbound NIC API boundary in
-- nic-ewb-client.ts and is never persisted.
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE eway_bill.eway_bills
    ADD CONSTRAINT eway_bills_supply_type_check
    CHECK (supply_type IN ('outward', 'inward'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- eway_bill.eway_bills.sub_supply_type
-- Valid values: supply, export, job_work, for_own_use, sales_return, others
-- (source: modules/eway-bill/validators.ts createEwayBillBody.subSupplyType
-- z.enum). The DB stores these descriptive strings, not the government's
-- numeric 1-11 codes — nic-ewb-client.ts's mapSubSupplyType() confirms these
-- are the only 6 supported values and maps them to NIC's numeric codes only
-- for the outbound API call; not all 11 government codes are supported.
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE eway_bill.eway_bills
    ADD CONSTRAINT eway_bills_sub_supply_type_check
    CHECK (sub_supply_type IN ('supply', 'export', 'job_work', 'for_own_use', 'sales_return', 'others'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- eway_bill.eway_bills.doc_type
-- Valid values: invoice, bill, challan, credit_note, others (source:
-- modules/eway-bill/validators.ts createEwayBillBody.docType z.enum). The DB
-- stores these descriptive strings, not the government's INV/BIL/BOE/CHL/OTH
-- short codes — nic-ewb-client.ts's mapDocType() confirms this set (note it
-- has no "Bill of Entry" equivalent and includes credit_note instead, which
-- is not part of the standard government code list).
-- ============================================================================
DO $$ BEGIN
  ALTER TABLE eway_bill.eway_bills
    ADD CONSTRAINT eway_bills_doc_type_check
    CHECK (doc_type IN ('invoice', 'bill', 'challan', 'credit_note', 'others'))
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- VALIDATE all constraints (separate pass for production safety)
-- ============================================================================
ALTER TABLE item.stock_item_categories VALIDATE CONSTRAINT stock_item_categories_item_type_check;
ALTER TABLE item.stock_items VALIDATE CONSTRAINT stock_items_item_type_check;
ALTER TABLE ledger.stock_ledger VALIDATE CONSTRAINT stock_ledger_voucher_type_check;
ALTER TABLE eway_bill.eway_bills VALIDATE CONSTRAINT eway_bills_supply_type_check;
ALTER TABLE eway_bill.eway_bills VALIDATE CONSTRAINT eway_bills_sub_supply_type_check;
ALTER TABLE eway_bill.eway_bills VALIDATE CONSTRAINT eway_bills_doc_type_check;
