# Module 10: Audit — World-Class Enhancement

## Benchmark: SAP GRC / AuditBoard / TeamMate+ / CAAT Tools

## Target Service: `services/audit-service`

---

## Phase A: Deep Audit

Read all modules: events, plan, observation, para, risk, compliance, exports, admin, dashboard.

---

## Phase B: Gaps to Close (10/10 Target)

### Gap 1: Continuous Auditing (Automated Rule-Based Scanning)
- **What:** Define audit rules that run automatically against transaction data, flag exceptions
- **Implement:**
  - `POST /v1/audit/continuous-rules` — create rule (name, target_event_pattern, condition_expr, severity)
  - Rules evaluate against incoming audit events in real-time
  - `GET /v1/audit/continuous-rules/exceptions` — flagged exceptions with evidence
  - `PATCH /v1/audit/continuous-rules/exceptions/:id/review` — auditor reviews (false_positive | confirmed)
  - Schema: `audit.continuous_rules`, `audit.rule_exceptions`
- **Domain:** `evaluateRule(event, conditionExpr)`, `classifyException(exception, historicalFalsePositiveRate)`

### Gap 2: Audit Universe Mapping
- **What:** Map all auditable entities (processes, departments, systems) with risk ratings, audit frequency
- **Implement:**
  - `POST /v1/audit/universe/entities` — define auditable entity (name, type, risk_rating, last_audited, frequency)
  - `GET /v1/audit/universe` — complete universe with coverage gaps highlighted
  - `GET /v1/audit/universe/coverage-report` — % entities audited within frequency, overdue entities
  - `POST /v1/audit/universe/generate-plan` — auto-generate annual plan based on risk and frequency
  - Schema: `audit.audit_universe` (id, tenant_id, name, type, department_id, risk_rating, frequency_months, last_audited_at)
- **Domain:** `computeCoverageGap(universe, plans)`, `generateRiskBasedPlan(universe, resources, year)`

### Gap 3: Statistical Sampling Engine
- **What:** Select audit samples using statistical methods (random, stratified, MUS)
- **Implement:**
  - `POST /v1/audit/sampling/generate` — generate sample (population_query, method, confidence, materiality)
  - Methods: `random`, `stratified` (by amount tier), `monetary_unit` (probability proportional to size)
  - `GET /v1/audit/sampling/:id/items` — list selected sample items
  - `POST /v1/audit/sampling/:id/results` — record findings per sample item
  - `GET /v1/audit/sampling/:id/extrapolation` — project findings to population (error rate, confidence interval)
  - Schema: `audit.sample_plans`, `audit.sample_items`, `audit.sample_results`
- **Domain:** `computeSampleSize(population, confidence, materiality)`, `stratifiedSample(items, strata)`, `extrapolateFindings(sampleResults, populationSize)`

### Gap 4: Workpaper Management
- **What:** Structured evidence repository per audit observation, versioned, access-controlled
- **Implement:**
  - `POST /v1/audit/workpapers` — create workpaper (observation_id, title, document_ref, notes)
  - `GET /v1/audit/observations/:id/workpapers` — list workpapers for an observation
  - `POST /v1/audit/workpapers/:id/review` — reviewer signs off on workpaper
  - Cross-reference to source documents (invoices, vouchers, contracts)
  - Schema: `audit.workpapers` (id, observation_id, plan_item_id, title, document_ref, storage_key, reviewed_by, reviewed_at)
- **Domain:** `checkWorkpaperCompleteness(observation, requiredDocuments)`, `validateReviewChain(workpaper)`

### Gap 5: Data Analytics Within Audit
- **What:** Run analytical procedures (Benford's law, duplicate detection, gap analysis) on transaction data
- **Implement:**
  - `POST /v1/audit/analytics/benfords-law` — test first-digit distribution of a dataset against expected
  - `POST /v1/audit/analytics/duplicate-detection` — find duplicate payments/entries (same amount+vendor+date)
  - `POST /v1/audit/analytics/gap-detection` — find gaps in sequential numbers (receipt nos, voucher nos)
  - `POST /v1/audit/analytics/aging` — age analysis of outstanding items
  - Schema: `audit.analytics_runs` (id, type, parameters, results_json, created_at)
- **Domain:** `benfordsTest(values)`, `detectDuplicates(records, matchFields)`, `findSequenceGaps(numbers)`

### Gap 6: Follow-Up Automation
- **What:** Track compliance with audit recommendations, auto-escalate overdue actions
- **Implement:**
  - Observation already has lifecycle — extend with `action_items`:
  - `POST /v1/audit/observations/:id/actions` — create action item (description, responsible, due_date)
  - `PATCH /v1/audit/actions/:id/complete` — mark action completed with evidence
  - `GET /v1/audit/actions/overdue` — overdue action items (auto-escalation trigger)
  - Sweeper: daily check → if overdue > 7 days → escalate to next level + notification
  - Schema: `audit.observation_actions` (id, observation_id, description, responsible_id, due_date, status, escalation_level)
- **Domain:** `identifyOverdue(actions)`, `escalate(action, level)`

### Gap 7: CAG Report Format Export
- **What:** Generate audit reports in CAG (Comptroller & Auditor General) prescribed format
- **Implement:**
  - `POST /v1/audit/exports/cag-format` — generate CAG-format report (plan_id, period, format: pdf|docx)
  - Template includes: executive summary, para-wise details, recovery status, dept responses
  - `GET /v1/audit/exports/templates` — available export templates (CAG, internal, board)
  - Schema: Leverages existing export infrastructure + new templates
- **Domain:** `generateCAGReport(plan, paras, responses)`, `formatAsCAGStructure(data)`

### Gap 8: SOX/Clause 49 Compliance Mapping
- **What:** Map controls to SOX/Clause 49 requirements, track control effectiveness
- **Implement:**
  - `POST /v1/audit/compliance/controls` — define control (name, objective, frequency, owner, regulation_ref)
  - `POST /v1/audit/compliance/controls/:id/test` — record control test result (effective/deficiency/material_weakness)
  - `GET /v1/audit/compliance/dashboard` — control effectiveness by regulation, deficiency summary
  - `GET /v1/audit/compliance/gap-report` — controls not tested within required frequency
  - Schema: `audit.compliance_controls`, `audit.control_tests`
- **Domain:** `assessControlEffectiveness(tests)`, `identifyGaps(controls, testHistory, requiredFrequency)`

---

## Phase C–F: Same structure as Module 01

Implementation order: Continuous Auditing → Follow-Up Automation → Data Analytics → Sampling Engine → Audit Universe → Workpapers → CAG Export → SOX Compliance

**TOTAL: _/10**
