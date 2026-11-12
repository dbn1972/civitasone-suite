# Inventory and stock: one ledger per tenant

## Problem (SMC, 12 Nov 2026)

Two item masters existed side by side. inventory-service holds items (by sku), stores and balances
(`onHandQty`, `avgRateMinor`). stock-service (legacy) holds items (by itemCode), warehouses and the
stock register. The stock entry screen (`/inventory/ledger/new`) posted to stock-service
(`POST /v1/stock/entries`), so a tenant that set up items and stores in inventory found nothing to
issue, and every item read "Not linked".

## Decision: the screens use inventory-service (option b)

`services/inventory-service/DEPRECATED.md` states that inventory-service is the canonical
implementation, stock-service is legacy in maintenance mode, and no new features go to stock-service.
Option (a) (category/UoM create APIs and a sync into stock-service) would have added features to the
legacy service and created a second copy of every balance that can drift from the first. Option (b)
needs none of that: inventory-service already has receipts, issues, transfers, adjustments, balances
and a ledger. Only the screens were pointed at the wrong service.

## What changes

- New per-tenant setting `ledgerSource` in `inventory.tenant_settings` (migration 0027).
  `stock` (default, also when there is no settings row) is today's behaviour. `inventory` switches the
  screens for that tenant.
- `GET/PUT /v1/inventory/settings` carry `ledgerSource` (PUT accepts either setting, at least one).
- With `inventory`: `/inventory/ledger/new` posts to `/v1/inventory/{receipts,issues,transfers,adjustments}`
  using inventory items and stores; `/inventory/list`, `/inventory/items` and the item page read inventory
  items and balances and show no "Linked / Not linked" status.
- The item picker accepts `masters=inventory` (item master only, never calls stock-service).
- No data is copied. Existing tenants are unchanged until the setting is switched.

## `/inventory/list` banner

The list read stock-service only. stock-service answers 403 to any role outside its own list
(stock_manager, stock_admin, super_admin, procurement_officer, audit_officer), which includes every
inventory role and tenant_admin, and the page showed a generic "could not load". A 403 now shows
"Access restricted". An empty 200 list was verified to map to an empty register, not an error.

## Roles

- Issue, receive, transfer: inventory_user, inventory_manager, inventory_admin, store_keeper (existing).
- Stock count adjustment: inventory_manager, inventory_admin (existing).
- Create items: the write roles above (store_keeper included). Create stores: inventory_manager and above.
- Switch the ledger source: inventory_admin, super_admin, tenant_admin (new). tenant_admin may change
  `ledgerSource` only; `qcMakerChecker` (segregation of duties) stays with inventory_admin and super_admin.
- `GET /v1/inventory/ledger-source` is a narrow read (`ledgerSource` and the caller's `canAdjust`) open to
  the inventory readers plus stock_manager, stock_admin, procurement_officer, procurement_admin and
  store_officer, who cannot read the full settings. The entry screen uses it; if it cannot be read the screen
  shows a retry error and never falls back to the stock-service form (a write must not guess). Reads still
  fall back to the stock register.
- tenant_admin may also read items, stores, balances, the ledger and the settings, but cannot post stock
  and no other register (bins, goods returns, reservations, substitutes, low stock) is widened for it.
- The Adjustment option is shown only to inventory_manager, inventory_admin and super_admin. Give store staff `store_keeper`; give the person who owns counts
  and stores `inventory_manager`.

## Not covered

Other screens that read stock-service (reconcile, the `/stock` module, hub tiles) keep using it for
tenants on `stock`. A tenant on `inventory` should treat the Inventory screens as its stock records.

## Cut-over runbook (per tenant)

Switching `ledgerSource` copies no data. The inventory screens show only what is in inventory-service.

1. Before switching, compare the stock register with inventory for the tenant (item count, on-hand per item).
   A tenant whose history lives only in stock-service will see an empty or smaller inventory list afterwards.
2. For anything held only in the stock register, receive it into the matching inventory store as opening stock
   (New stock entry > Receipt, with the reference "Opening balance"), item by item, before or right after the switch.
3. Switch (Inventory > Settings > Stock ledger). Check /inventory/list, /inventory/reconcile and one issue.
4. Rollback is the same switch; no data is changed by either direction. Stock-service data stays as it was and is
   simply no longer shown to that tenant.

### GRN and other writers (checked in the code)

- Procurement publishes `procurement.grn.accepted`. inventory-service consumes it and posts the receipt (store from
  the GRN, inventory item ids), finance-service posts the GL from the resulting inventory movement, asset-service
  and notification-service consume it too.
- **stock-service also consumes the same event** (`stock-service/src/modules/entry/consumer.ts`, "GRN accepted ->
  stock receipt for consumable items") and writes its own valuation, ledger and receipt rows for each consumable line
  that carries an `itemId`, into warehouse `00000000-0000-4000-8000-000000000000` when the GRN names none. It has
  no knowledge of `ledgerSource`, so for a tenant on the inventory ledger it keeps producing stock-register rows
  that no screen shows (or dead-letters if the item is not a stock item). They are harmless to inventory balances
  and GL, but they are noise. Not changed here: stock-service is frozen legacy and gating it needs a cross-service
  tenant-setting read. Recommended follow-up: skip the consumer for tenants on the inventory ledger, or
  decommission stock-service for them.
- No other service writes to stock-service entries; the only non-inventory callers of stock-service are the
  read-only item cross-reference used by the link screens (inventory-service `stock-client.ts`), which inventory-mode
  screens do not call.
