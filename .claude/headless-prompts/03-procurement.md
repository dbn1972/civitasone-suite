You are building the Procurement module for CivitasOne Suite. Read CLAUDE.md first.

## Context
Screen references (read ALL .html files):
- ~/CivitasOne/erpnext-develop/procurement-module/web/
  Key screens: dashboard.html, indent.html, indent-detail.html, purchase-order.html,
  po-detail.html, grn.html, grn-detail.html, vendor-management.html, vendor-detail.html,
  vendor-registration.html, reverse-auction.html, contract.html, contract-detail.html,
  gem-integration.html, rate-contract.html, three-quotations.html, mse-preference.html

ERPNext reference: ~/CivitasOne/erpnext-develop/erpnext/buying/doctype/

Schema: ~/CivitasOne/erpnext-develop/MODULES_AND_SCHEMA.md section 3.4

Services: services/procurement-service, services/contract-service
  procurement DB: civitas_procurement, role: procurement_svc, password: procurement_dev_pw
  contract DB: civitas_contract, role: contract_svc, password: contract_dev_pw
Prefix: procurement_, contract_

## Modules inside procurement-service (L2 schemas)
src/modules/
  indent/      — material indent / purchase requisition
  vendor/      — vendor registration, empanelment, MSE/MSME
  po/          — purchase order, GeM direct order
  grn/         — goods receipt note, quality inspection
  auction/     — reverse auction / e-procurement
  payments/    — vendor advance, debit note

## Step 1 — Migration
services/procurement-service/migrations/0001_init.sql:
  Schema indent:      procurement_indents, procurement_indent_items
  Schema vendor:      procurement_vendors, procurement_vendor_docs, procurement_empanelment
  Schema po:          procurement_pos, procurement_po_items
  Schema grn:         procurement_grns, procurement_grn_items, procurement_inspections
  Schema auction:     procurement_auctions, procurement_bids
  Schema payments:    procurement_advances, procurement_debit_notes

services/contract-service/migrations/0001_init.sql:
  Schema contracts:   contract_contracts, contract_milestones, contract_amendments
  Schema rate:        contract_rate_contracts, contract_rate_items

Critical constraints:
- Money fields: bigint (paise), currency char(3) default 'INR'
- procurement_pos.sanction_ref text (opaque "finance_sanction:UUID") — budget link
- procurement_pos.status check in ('draft','approved','gem_placed','dispatched','closed','cancelled')
- procurement_grns: three_way_match boolean default false (set true when qty and quality pass)
- procurement_vendors: vendor_type check in ('registered','empanelled','blacklisted')
- procurement_vendors.mse boolean default false, msme boolean default false
- contract_contracts.value_minor bigint, contract_contracts.expiry date
- audit trail on every status change via outbox

## Step 2 — CQRS routes + consumers
Use tenant-service as template.

Indent module:
  POST /procurement/indents           → procurement.indent.create
  PATCH /procurement/indents/:id/approve → procurement.indent.approve
  GET  /procurement/indents?tenantId= → cache → repo

Vendor module:
  POST /procurement/vendors           → procurement.vendor.create
  PATCH /procurement/vendors/:id/empanel → procurement.vendor.empanel
  PATCH /procurement/vendors/:id/blacklist → procurement.vendor.blacklist (auto-notify)
  GET  /procurement/vendors/:id       → cache → repo

PO module:
  POST /procurement/pos               → procurement.po.create
    Consumer: BEFORE writing PO, call finance-service GET /finance/sanctions/:sanction_ref/available
    If budget unavailable → emit procurement.po.budget_exceeded, reject
  PATCH /procurement/pos/:id/dispatch → procurement.po.dispatch
  GET  /procurement/pos/:id           → cache → repo
  POST /procurement/pos/gem           → procurement.gem_order.create (GeM direct)

GRN module:
  POST /procurement/grns              → procurement.grn.create
    Consumer: match GRN items to PO items (qty check), set three_way_match=true if pass
    Emit procurement.grn.accepted → consumed by finance-service (triggers bill creation)
    Emit procurement.grn.rejected → stays pending
  GET  /procurement/grns/:id          → cache → repo

Contract service:
  POST /contract/contracts            → contract.contract.create
  PATCH /contract/contracts/:id/amend → contract.contract.amend
  GET  /contract/contracts/:id        → cache → repo
  GET  /contract/rate-contracts?item= → cache → repo

## Step 3 — Domain rules
- PO cannot be raised without approved indent
- PO value must not exceed sanction available amount (finance-service HTTP call in consumer)
- GRN three-way match: qty received == qty ordered AND quality inspection passed
- Vendor blacklist: emit notification.send → vendor receives email
- MSE preference: on reverse auction close, apply 15% price preference to MSE vendors
- Rate contract: PO can reference rate contract (rate_contract_ref) — price validated from rate

## Step 4 — Events
procurement.indent.approved → triggers procurement.po.create workflow notification
procurement.po.approved     → consumed by inventory (if stock service exists)
procurement.grn.accepted    → consumed by finance-service (creates bill)
procurement.grn.accepted    → consumed by asset-service (fixed asset receipt)
procurement.vendor.blacklisted → consumed by notification-service

## Step 5 — Tests
- Indent approval state machine: draft→approved→closed
- PO budget check: mock finance-service returns insufficient → consumer rejects PO
- GRN three-way match: qty mismatch → three_way_match=false, event not emitted
- CQRS wiring: POST /procurement/grns → SQS → consumer → DB (MemoryQueue + MemoryCache)

## Step 6 — Apply migration + typecheck + test
docker exec -e PGPASSWORD=procurement_dev_pw -i civitasone-postgres \
  psql -U procurement_svc -d civitas_procurement < services/procurement-service/migrations/0001_init.sql
docker exec -e PGPASSWORD=contract_dev_pw -i civitasone-postgres \
  psql -U contract_svc -d civitas_contract < services/contract-service/migrations/0001_init.sql
cd services/procurement-service && pnpm typecheck && pnpm test
cd services/contract-service && pnpm typecheck && pnpm test

Report: routes, tables, test results. Flag any GFR (General Financial Rules) constraints visible in the screens.
