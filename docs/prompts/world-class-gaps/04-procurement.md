# Module 04: Procurement — World-Class Enhancement

## Benchmark: SAP Ariba / Coupa / Oracle Procurement Cloud / GeM

## Target Service: `services/procurement-service`

---

## Phase A: Deep Audit

Read all 16 modules in `services/procurement-service/src/modules/`.

---

## Phase B: Gaps to Close (10/10 Target)

### Gap 1: Supplier Risk Scoring
- **What:** Composite risk score per vendor (financial health, compliance history, delivery performance, blacklist proximity)
- **Implement:**
  - `GET /v1/procurement/vendors/:id/risk-score` — returns composite score + breakdown
  - `GET /v1/procurement/vendors/risk-dashboard` — heat map of all vendors by risk tier
  - Auto-recalculate on: GRN rejection, late delivery, quality issue, blacklist event
  - Schema: `vendor.vendor_risk_scores` (vendor_id, financial_score, delivery_score, compliance_score, composite, calculated_at)
- **Domain:** `computeRiskScore(deliveryHistory, grnRejections, blacklistHistory, financialData)`

### Gap 2: Spend Analytics & Category Management
- **What:** Classify all spending by category, identify consolidation opportunities, benchmark unit prices
- **Implement:**
  - `GET /v1/procurement/analytics/spend-by-category?fy=2025-26` — treemap of spend by category
  - `GET /v1/procurement/analytics/price-benchmarks?itemCode=X` — historical unit price trend + comparison across vendors
  - `GET /v1/procurement/analytics/maverick-spend` — orders placed outside rate contracts
  - Schema: `analytics.spend_facts` (materialized/cached from PO + payment data)
- **Domain:** `classifySpend(poLines)`, `detectMaverickPurchases(pos, rateContracts)`

### Gap 3: Supplier Collaboration Portal
- **What:** Vendors self-service: view POs, submit invoices, check payment status, update profile
- **Implement:**
  - `GET /v1/procurement/portal/my-pos` — vendor sees their POs (vendor auth token)
  - `POST /v1/procurement/portal/invoices` — vendor submits invoice against PO/GRN
  - `GET /v1/procurement/portal/payments` — payment status for submitted invoices
  - `PATCH /v1/procurement/portal/profile` — vendor updates bank/address
  - Vendor-specific auth: separate JWT role `vendor_portal`
- **Domain:** `validateInvoiceAgainstPO(invoice, po, grn)`, portal access control

### Gap 4: Dynamic Discounting
- **What:** Offer early payment in exchange for discount (vendor opts in per invoice)
- **Implement:**
  - `POST /v1/procurement/dynamic-discount/offers` — create offer (invoice_id, discount_rate_bps, early_pay_date)
  - `POST /v1/procurement/dynamic-discount/offers/:id/accept` — vendor accepts
  - On acceptance: reschedule payment to early date, reduce amount by discount
  - `GET /v1/procurement/dynamic-discount/savings` — total savings from early payments
  - Schema: `payments.dynamic_discount_offers` (id, invoice_id, vendor_id, discount_bps, early_date, status)
- **Domain:** `computeDiscount(invoiceMinor, discountBps)`, `computeAPR(daysSaved, discountBps)`

### Gap 5: RFQ/RFP Evaluation Matrix
- **What:** Weighted multi-criteria evaluation of vendor responses (technical + commercial scoring)
- **Implement:**
  - `POST /v1/procurement/rfq/:id/evaluation-criteria` — define criteria (weight, scoring_method)
  - `POST /v1/procurement/rfq/:id/evaluations` — evaluator scores each vendor per criterion
  - `GET /v1/procurement/rfq/:id/evaluation-summary` — weighted composite per vendor, rank order
  - `POST /v1/procurement/rfq/:id/award` — award to highest-scoring vendor (requires L1 validation)
  - Schema: `tender.evaluation_criteria`, `tender.evaluation_scores`
- **Domain:** `computeWeightedScore(criteria, scores)`, `validateL1Compliance(vendor, mandatoryChecks)`

### Gap 6: Sustainability / ESG Scoring
- **What:** Track green procurement metrics, vendor ESG compliance, carbon footprint of purchases
- **Implement:**
  - `POST /v1/procurement/esg/vendor-declarations` — vendor submits ESG self-declaration
  - `GET /v1/procurement/esg/dashboard` — % green procurement, top carbon contributors
  - `GET /v1/procurement/esg/vendors/:id/score` — ESG compliance score
  - Mandatory check at PO: warn if vendor has no ESG declaration for orders > threshold
  - Schema: `vendor.esg_declarations` (vendor_id, carbon_footprint, certifications, self_assessed_at)
- **Domain:** `computeESGScore(declarations, certifications)`, `greenProcurementPercentage(pos)`

### Gap 7: Catalog Management (Punchout)
- **What:** Searchable item catalog from rate contracts, "punchout" to vendor catalog for selection
- **Implement:**
  - `GET /v1/procurement/catalog/search?q=paper&category=stationery` — search available items from active rate contracts
  - `GET /v1/procurement/catalog/items/:id` — item detail with pricing, vendor, availability
  - `POST /v1/procurement/catalog/cart` — add items to requisition cart
  - `POST /v1/procurement/catalog/cart/checkout` — convert cart to indent
  - Schema: leverages existing rate_contract_items + search index
- **Domain:** `searchCatalog(query, filters)`, `cartToIndent(cartItems, requester)`

### Gap 8: Procure-to-Pay Cycle Analytics
- **What:** End-to-end cycle time visibility: indent → PO → GRN → payment
- **Implement:**
  - `GET /v1/procurement/analytics/cycle-time` — avg days per stage (indent→PO, PO→GRN, GRN→payment)
  - `GET /v1/procurement/analytics/bottlenecks` — stages with longest avg wait
  - `GET /v1/procurement/analytics/aging` — POs pending GRN > 30 days, invoices pending payment > 30 days
- **Domain:** `computeCycleTime(indent, po, grn, payment)`, `identifyBottleneck(stages)`

---

## Phase C–F: Same structure as Module 01

Implementation order: Risk Scoring → Spend Analytics → Evaluation Matrix → Catalog → Cycle Analytics → Supplier Portal → Dynamic Discounting → ESG

**TOTAL: _/10**
