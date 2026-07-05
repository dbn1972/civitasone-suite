# Module 09: Legal — World-Class Enhancement

## Benchmark: Thomson Reuters Legal Tracker / Clio / CaseMaster / eCourts India

## Target Service: `services/legal-service`

---

## Phase A: Deep Audit

Read all modules: cases, hearings, notices, contracts, counsel, filings, opinions, settlements, reminders, dashboard.

---

## Phase B: Gaps to Close (10/10 Target)

### Gap 1: eCourt Integration (Live Case Status from NJDG)
- **What:** Auto-fetch case status, next hearing date, orders from National Judicial Data Grid
- **Implement:**
  - `POST /v1/legal/cases/:id/link-ecourt` — link to eCourt CNR number
  - `POST /v1/legal/ecourt/sync` — scheduled sync of all linked cases (fetch status, next_date, orders)
  - `GET /v1/legal/cases/:id/ecourt-status` — latest synced status from eCourt
  - Auto-update: if next hearing date changes → update case, emit notification
  - Schema: `cases.ecourt_links` (case_id, cnr_number, last_synced_at, ecourt_status_json)
- **Domain:** `parseECourtResponse(html|json)`, `detectStatusChange(previous, current)`

### Gap 2: Document Assembly (Templated Pleadings)
- **What:** Generate legal documents (affidavits, counter, vakalatnama) from templates with case data merged
- **Implement:**
  - `POST /v1/legal/templates` — create document template (type, content_with_placeholders, variables)
  - `POST /v1/legal/templates/:id/generate` — merge case/hearing data into template → produce document
  - `GET /v1/legal/templates` — list available templates by document type
  - Schema: `cases.document_templates` (id, tenant_id, name, type, template_content, variables_schema)
- **Domain:** `mergeTemplate(template, caseData)`, `extractVariables(templateContent)`

### Gap 3: Outside Counsel Spend Analytics
- **What:** Track legal fees paid to external counsel, analyze spend by case/counsel/category
- **Implement:**
  - `POST /v1/legal/counsel-fees` — record fee payment (counsel_id, case_id, amount_minor, fee_type, period)
  - `GET /v1/legal/analytics/counsel-spend` — total spend by counsel, by case type, by period
  - `GET /v1/legal/analytics/cost-per-case` — average legal cost per case category
  - `GET /v1/legal/analytics/budget-vs-actual` — planned legal budget vs actual counsel spend
  - Schema: `counsel.counsel_fees` (id, tenant_id, counsel_id, case_id, amount_minor, fee_type, invoice_ref, paid_at)
- **Domain:** `computeSpendByCategory(fees)`, `budgetVariance(planned, actual)`

### Gap 4: Compliance Calendar (Limitation Period Tracking)
- **What:** Track statutory deadlines (limitation periods, appeal windows, compliance due dates)
- **Implement:**
  - `POST /v1/legal/compliance/deadlines` — create deadline (case_id, type, due_date, statutory_basis, consequence)
  - `GET /v1/legal/compliance/upcoming?days=30` — deadlines due in next N days
  - `GET /v1/legal/compliance/overdue` — missed deadlines (critical alert)
  - Auto-alert: 7 days, 3 days, 1 day before deadline → emit notification
  - Schema: `cases.compliance_deadlines` (id, tenant_id, case_id, type, due_date, statutory_basis, status)
- **Domain:** `identifyUpcoming(deadlines, days)`, `computeLimitationDate(eventDate, periodDays)`

### Gap 5: Court Order Compliance Tracking
- **What:** When court issues an order with action items, track compliance of each directive
- **Implement:**
  - `POST /v1/legal/orders/:id/directives` — break order into individual directives (action, responsible, due_date)
  - `PATCH /v1/legal/directives/:id/comply` — mark directive as complied (evidence_ref)
  - `GET /v1/legal/orders/:id/compliance-status` — % complied, overdue directives
  - `GET /v1/legal/compliance/contempt-risk` — cases with uncomplied court orders past due date
  - Schema: `cases.order_directives` (id, order_id, case_id, directive_text, responsible_id, due_date, status, complied_at)
- **Domain:** `computeComplianceRate(directives)`, `identifyContemptRisk(overdue, daysPastDue)`

### Gap 6: Litigation Budgeting & Forecasting
- **What:** Estimate total litigation cost per case, forecast organization-wide legal spend
- **Implement:**
  - `POST /v1/legal/cases/:id/budget` — create case budget (estimated_fees, court_fees, misc, contingency)
  - `GET /v1/legal/budgeting/forecast?fy=2026-27` — projected legal spend by category/court/type
  - `GET /v1/legal/budgeting/provision-report` — cases requiring financial provisioning (high-risk + high-value)
  - Schema: `cases.case_budgets` (case_id, estimated_total_minor, spent_minor, contingency_minor)
- **Domain:** `forecastLegalSpend(activeCases, avgCostPerType, newCaseRate)`, `provisioningAmount(risk, exposure)`

### Gap 7: AI-Powered Case Outcome Prediction
- **What:** Based on case type, court, jurisdiction, past outcomes → predict win/loss probability
- **Implement:**
  - `GET /v1/legal/cases/:id/prediction` — predicted outcome (win/partial/loss), confidence, factors
  - Based on: historical case outcomes in same court + same type + similar facts
  - Fallback: rule-based heuristic (if no ML model) based on completion rates by case category
  - Schema: `cases.outcome_predictions` (case_id, predicted_outcome, confidence, model_version, generated_at)
- **Domain:** `predictOutcome(caseType, court, historicalData)`, `computeConfidence(sampleSize, consistency)`

### Gap 8: E-Filing Integration
- **What:** Submit filings electronically to courts that support e-filing (specific High Courts)
- **Implement:**
  - `POST /v1/legal/efiling/submit` — submit filing electronically (court, case_cnr, document, filing_type)
  - `GET /v1/legal/efiling/:id/status` — check acceptance/rejection status
  - `GET /v1/legal/efiling/supported-courts` — list of courts with e-filing integration
  - Schema: `filings.efiling_records` (id, filing_id, court_code, submission_ref, status, response_json)
- **Domain:** `buildEFilingPayload(filing, court)`, `parseEFilingResponse(response)`

---

## Phase C–F: Same structure as Module 01

Implementation order: Compliance Calendar → Court Order Tracking → eCourt Integration → Document Assembly → Counsel Spend → Litigation Budget → Outcome Prediction → E-Filing

**TOTAL: _/10**
