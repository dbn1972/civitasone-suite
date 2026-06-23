-- Item type on PO lines for GRN → stock vs fixed-asset routing
ALTER TABLE po.procurement_po_items
  ADD COLUMN IF NOT EXISTS item_type varchar(16) NOT NULL DEFAULT 'consumable';
