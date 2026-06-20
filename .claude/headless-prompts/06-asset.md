You are building the Asset & Inventory module for CivitasOne Suite. Read CLAUDE.md first.

## Context
Screen references (read ALL .html files):
- ~/CivitasOne/erpnext-develop/asset-module/web/
  Key screens: dashboard.html, asset-list.html, asset-detail.html, asset-register.html,
  depreciation.html, disposal.html, transfer.html, maintenance.html, insurance.html,
  stock-ledger.html, stock-entry.html, warehouse.html, item-master.html, item-detail.html,
  inventory-report.html, physical-verification.html

ERPNext reference: ~/CivitasOne/erpnext-develop/erpnext/assets/doctype/ and erpnext/stock/doctype/

Schema: ~/CivitasOne/erpnext-develop/MODULES_AND_SCHEMA.md section 3.7

Services: services/asset-service, services/stock-service
  asset DB: civitas_asset, role: asset_svc, password: asset_dev_pw
  stock DB: civitas_stock, role: stock_svc, password: stock_dev_pw
Prefix: asset_, stock_

## Modules inside asset-service (L2 schemas)
src/modules/
  register/    — fixed asset register, asset categories
  lifecycle/   — acquisition, transfer, disposal, write-off
  depreciation/— depreciation schedules, posting
  maintenance/ — maintenance schedule, work orders
  insurance/   — insurance policies, renewals, claims

## Modules inside stock-service (L2 schemas)
src/modules/
  item/        — item master, UOM, categories
  warehouse/   — warehouses, storage locations
  ledger/      — stock ledger entries (append-only)
  entry/       — stock entries (receipt, issue, transfer, adjustment)
  valuation/   — weighted average / FIFO cost

## Step 1 — Migration
services/asset-service/migrations/0001_init.sql:
  Schema register:    asset_categories, asset_assets
  Schema lifecycle:   asset_acquisitions, asset_transfers, asset_disposals
  Schema depreciation: asset_dep_schedules, asset_dep_entries
  Schema maintenance: asset_maintenance_plans, asset_work_orders
  Schema insurance:   asset_policies, asset_claims

services/stock-service/migrations/0001_init.sql:
  Schema item:        stock_items, stock_uoms, stock_item_categories
  Schema warehouse:   stock_warehouses, stock_locations
  Schema ledger:      stock_ledger (append-only: no UPDATE/DELETE)
  Schema entry:       stock_entries, stock_entry_items
  Schema valuation:   stock_valuation_rates

Critical constraints:
- Money fields: bigint (paise), currency default 'INR'
- asset_assets.status check in ('active','under_maintenance','transferred','disposed','written_off')
- asset_dep_schedules: computed on acquisition_cost, rate, method ('SLM','WDV')
- stock_ledger: append-only (every stock movement creates a new ledger row, no UPDATE)
- stock_valuation_rates: updated on each receipt using weighted average formula
- asset_acquisitions.po_ref text (opaque 'procurement_po:UUID') — links to procurement
- asset_acquisitions.grn_ref text (opaque 'procurement_grn:UUID') — 3-way match from GRN

## Step 2 — CQRS routes + consumers
Asset register:
  POST /assets                          → asset.asset.create
    Consumer: triggered by procurement.grn.accepted event (fixed asset GRN)
    Also supports manual creation
  PATCH /assets/:id/transfer            → asset.asset.transfer
  PATCH /assets/:id/dispose             → asset.asset.dispose
    Consumer: emit finance.gl.post (debit accumulated depreciation, credit asset, gain/loss)
  GET  /assets/:id                      → cache → repo
  GET  /assets?category=&status=        → cache → repo (paginated)

Depreciation:
  POST /assets/:id/depreciation/schedule → asset.dep.schedule (compute and store schedule)
  POST /assets/depreciation/run          → asset.dep.run (monthly job — posts all due entries)
    Consumer: for each due entry → emit finance.gl.post (debit dep expense, credit accum dep)
  GET  /assets/:id/depreciation          → cache → repo

Maintenance:
  POST /assets/:id/maintenance          → asset.maintenance.plan
  POST /assets/work-orders              → asset.work_order.create
  PATCH /assets/work-orders/:id/complete → asset.work_order.complete

Stock items:
  POST /stock/items                     → stock.item.create
  GET  /stock/items/:id                 → cache → repo
  GET  /stock/items?category=           → cache → repo

Stock entries:
  POST /stock/entries                   → stock.entry.create
    Consumer: validate quantities, write stock_ledger row(s), update valuation_rates
    Entry types: receipt (from GRN), issue, transfer (between warehouses), adjustment
  GET  /stock/ledger?itemId=&from=&to=  → paginated ledger
  GET  /stock/valuation?itemId=         → cache → repo (current weighted avg rate)
  POST /stock/physical-verification     → stock.physical.create (cycle count)

## Step 3 — Domain rules
- Depreciation: SLM = (cost - salvage) / useful_life_years / 12 per month
- WDV = book_value * rate / 12 per month
- Stock valuation (weighted avg): new_rate = (old_qty * old_rate + receipt_qty * receipt_rate) / (old_qty + receipt_qty)
- Disposal: GL posting = debit accumulated_depreciation + debit loss (or credit gain) = credit asset cost
- Stock cannot go negative: consumer rejects issue if qty > current_stock
- Fixed asset from procurement: triggered when procurement.grn.accepted event contains item_type='fixed_asset'

## Step 4 — Events consumed
procurement.grn.accepted → asset.asset.create (for fixed asset items)
procurement.grn.accepted → stock.entry.create (for consumable items, type=receipt)

## Step 5 — Events emitted
asset.dep.posted      → finance-service (GL posting)
asset.disposed        → finance-service (GL posting: gain/loss)
stock.entry.created   → finance-service (GL: stock account debit/credit)

## Step 6 — Tests
- Depreciation SLM: cost=1000000, salvage=0, life=5yr → monthly=16667 paise
- Weighted avg valuation: 100 units at 100, receive 50 at 120 → new rate = 106.67
- Stock negative guard: issue qty=150 when stock=100 → consumer rejects
- CQRS: POST /stock/entries → SQS → consumer → ledger appended (MemoryQueue)

## Step 7 — Apply migration + typecheck + test
docker exec -e PGPASSWORD=asset_dev_pw -i civitasone-postgres \
  psql -U asset_svc -d civitas_asset < services/asset-service/migrations/0001_init.sql
docker exec -e PGPASSWORD=stock_dev_pw -i civitasone-postgres \
  psql -U stock_svc -d civitas_stock < services/stock-service/migrations/0001_init.sql
cd services/asset-service && pnpm typecheck && pnpm test
cd services/stock-service && pnpm typecheck && pnpm test

Report: routes, tables, test results.
