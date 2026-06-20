# Skill — Procurement Workflows

**When to load:** Building anything in `procurement-service` or anything that touches PR/PO/GRN/invoice flow.

---

## The procure-to-pay flow

```
Need → PR → RFQ → Quotations → PO → GRN → Invoice → 3-way match → Payment
```

States per document and allowed transitions:

### Purchase Request (PR)
- `draft` → `submitted` → `approved` → `converted_to_rfq` | `converted_to_po`
- `draft` → `cancelled`
- `submitted` → `rejected` (with reason)

### Request for Quotation (RFQ)
- `draft` → `published` → `closed` → `awarded`
- `published` → `cancelled`

### Quotation (vendor response)
- `submitted` → `shortlisted` | `rejected`
- `shortlisted` → `awarded`

### Purchase Order (PO)
- `draft` → `pending_approval` → `approved` → `partially_received` → `received` → `closed`
- `approved` → `cancelled` (only if no GRN yet)
- `received` → `invoiced`

### Goods Receipt Note (GRN)
- `draft` → `posted` (immutable after post; corrections via reverse GRN)

### Invoice (vendor invoice for matching)
- `received` → `matched` | `variance` | `rejected`
- `matched` → `approved_for_payment` → `paid`

## Three-way match (PO ↔ GRN ↔ Invoice)

For each invoice line, compute:

```
match.qty   = invoice.qty within tolerance of received.qty
match.price = invoice.unit_price within tolerance of PO.unit_price
match.total = invoice.line_total within tolerance of (matched_qty × matched_price + tax)
```

Tolerances configurable per tenant (default 2% on price, 0% on qty).
Result:
- All three match → `matched` → can flow to payment
- Any fails → `variance` → requires variance approval (role gated by amount)

## Required tables (procurement-service prefix)

- `procurement_vendors` (with KYC, PAN/GSTIN, bank details)
- `procurement_purchase_requests` + `procurement_pr_lines`
- `procurement_rfqs` + `procurement_rfq_lines` + `procurement_rfq_vendors`
- `procurement_quotations` + `procurement_quotation_lines`
- `procurement_purchase_orders` + `procurement_po_lines`
- `procurement_goods_receipts` + `procurement_grn_lines`
- `procurement_supplier_invoices` + `procurement_invoice_lines` + `procurement_match_records`

## Events emitted

- `procurement.pr.submitted` → notifies approver
- `procurement.po.approved` → finance commits budget, inventory expects receipt
- `procurement.grn.posted` → inventory increments stock, finance posts accrual
- `procurement.invoice.matched` → finance posts liability
- `procurement.invoice.variance` → notifies finance manager + procurement manager
- `procurement.payment.released` → finance settles liability

## Cross-service interactions (HTTP only — never DB)

- Call `finance-service` for: budget check (POST /budgets/check), commitment create/release, payment trigger
- Call `inventory-service` for: stock update on GRN, return-to-vendor stock movement
- Call `policy-service` for: approval matrix evaluation (who approves what at what amount)
- Call `notification-service` (via queue): vendor onboarding emails, approval reminders

## Edition specifics

- **Govt Department:** mandatory tender flow (RFQ → bid → award) above threshold, e-procurement (GeM) integration Phase 2, integrity pact required for high-value
- **PSU:** vendor empanelment required, reverse auction support Phase 2, MSME quota tracking
- **Small Office:** PR optional (allow direct PO), no RFQ required

## Forbidden patterns

- Skipping budget check on PO approval → finance reconciliation breaks
- Editing posted GRN → use reverse GRN
- Approving a PO without matching the approval matrix → bypasses controls
- Receiving more than PO qty without explicit over-receipt approval
- Paying an invoice in `variance` state → must resolve first
