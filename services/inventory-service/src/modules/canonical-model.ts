/**
 * Canonical Inventory Data Model — unified model for inventory-service (Req 14.1).
 *
 * This module re-exports all schema tables that form the unified inventory model,
 * replacing the fragmented stock-service data model. The canonical model covers:
 *
 *   1. ITEMS       — item master, categories, UoMs (items/schema.ts)
 *   2. WAREHOUSES  — physical warehouse locations (warehouses/schema.ts)
 *   3. STORES      — sub-store / godown locations within warehouses (stores/schema.ts)
 *   4. MOVEMENTS   — stock movements: receipts, issues, transfers, adjustments (movements/schema.ts)
 *   5. COST LAYERS — FIFO/WAVG costing layers per item per warehouse (costing/schema.ts)
 *   6. BATCHES     — batch and serial number tracking (batches/schema.ts)
 *
 * Standard columns on every table:
 *   - id: UUID primary key
 *   - tenantId: UUID (RLS-enforced tenant isolation)
 *   - createdAt: timestamptz
 *   - updatedAt: timestamptz
 *   - createdBy: UUID (actor who created)
 *   - updatedBy: UUID (actor who last modified)
 *   - version: integer (optimistic locking)
 *
 * Money columns use BIGINT paise (e.g. unitCostPaise, rateMinor, amountMinor).
 * ISO 4217 currency stored alongside (default 'INR').
 *
 * Mapping from stock-service tables:
 *   stock.stock_items          → inventory.items
 *   stock.stock_item_categories → inventory.categories
 *   stock.stock_uoms           → inventory.uoms
 *   warehouse.stock_warehouses → inventory.warehouses
 *   warehouse.stock_locations  → inventory.stores
 *   entry.stock_entries        → inventory.movements
 *   entry.stock_entry_items    → inventory.movement_lines
 *   ledger.stock_ledger        → inventory.stock_ledger
 *   valuation.stock_valuation_rates → inventory.stock_balances
 *   entry.stock_receipts       → inventory.cost_layers
 */

// Items
export { items, categories, uoms } from "./items/schema.js";
export type { ItemRow, ItemInsert, CategoryRow, CategoryInsert, UomRow, UomInsert } from "./items/schema.js";

// Warehouses (canonical — replaces stock-service warehouses)
export { warehouses } from "./warehouses/schema.js";
export type { WarehouseRow, WarehouseInsert } from "./warehouses/schema.js";

// Stores (sub-locations within warehouses)
export { stores } from "./stores/schema.js";
export type { StoreRow, StoreInsert } from "./stores/schema.js";

// Stock movements (receipts, issues, transfers, adjustments)
export { movements, movementLines, stockBalances, stockLedger, reasonCodes } from "./movements/schema.js";
export type { MovementRow, MovementInsert, MovementLineInsert, StockBalanceRow, LedgerRow, LedgerInsert } from "./movements/schema.js";

// Cost layers (FIFO/WAVG)
export { costLayers } from "./costing/schema.js";
export type { CostLayerRow, CostLayerInsert } from "./costing/schema.js";

// Batch and serial tracking
export { batches, serialNumbers } from "./batches/schema.js";
export type { BatchRow, BatchInsert, SerialNumberRow, SerialNumberInsert } from "./batches/schema.js";
