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
- Switch the ledger source: inventory_admin, super_admin, tenant_admin (new).
- tenant_admin may now read items, stores, balances and the ledger, but cannot post stock: it is an
  oversight role, not a store operator. Give store staff `store_keeper`; give the person who owns counts
  and stores `inventory_manager`.

## Not covered

Other screens that read stock-service (reconcile, the `/stock` module, hub tiles) keep using it for
tenants on `stock`. A tenant on `inventory` should treat the Inventory screens as its stock records.
