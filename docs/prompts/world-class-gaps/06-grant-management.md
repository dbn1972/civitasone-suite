# Module 06: Grant Management — World-Class Enhancement

## Benchmark: SAP Grants Management / Oracle Grants Cloud / PFMS India

## Target Service: `services/grant-service`

---

## Phase A: Deep Audit

Read all modules: scheme, application, beneficiary, disbursement, utilisation, uc-validation, integration, dashboard.

---

## Phase B: Gaps to Close (10/10 Target)

### Gap 1: Impact Measurement Framework
- **What:** Define KPIs per scheme, track outcomes vs outputs, compute impact efficiency
- **Implement:**
  - `POST /v1/grant/schemes/:id/kpis` — define scheme KPIs (indicator, target, unit, measurement_frequency)
  - `POST /v1/grant/schemes/:id/kpis/:kpiId/report` — report measured value against target
  - `GET /v1/grant/schemes/:id/impact-dashboard` — KPI achievement %, trend, efficiency ratio (spend/outcome)
  - Schema: `scheme.scheme_kpis`, `scheme.kpi_measurements`
- **Domain:** `computeImpactEfficiency(totalDisbursed, kpiAchievements)`, `kpiTrend(measurements)`

### Gap 2: Beneficiary Deduplication (Aadhaar-Based)
- **What:** Detect duplicate beneficiaries across schemes using Aadhaar hash, prevent double-dipping
- **Implement:**
  - On beneficiary creation: hash Aadhaar → check existing hashes across all schemes in tenant
  - `GET /v1/grant/beneficiaries/duplicates` — list potential duplicates with confidence score
  - `POST /v1/grant/beneficiaries/:id/merge` — merge duplicate records (preserve history)
  - Schema: Add `aadhaar_hash varchar(64)` (SHA-256 of encrypted Aadhaar) + unique index
- **Domain:** `detectDuplicates(aadhaarHash, tenantId)`, `mergeBeneficiaryRecords(primary, duplicate)`

### Gap 3: Multi-Year Funding & Carry-Forward
- **What:** Schemes spanning multiple FYs with carry-forward of unspent balance
- **Implement:**
  - `POST /v1/grant/schemes/:id/allocations` — define multi-year allocation (fy, amount_minor, source)
  - `POST /v1/grant/schemes/:id/carry-forward` — carry unspent FY balance to next year
  - `GET /v1/grant/schemes/:id/multi-year-status` — year-wise allocation vs disbursement vs carry-forward
  - Schema: `scheme.scheme_allocations` (scheme_id, fy, allocated_minor, carried_forward_minor, source)
- **Domain:** `computeCarryForward(allocated, disbursed, lapsed)`, `validateAllocationVsBudget()`

### Gap 4: Outcome-Based Funding (Pay-for-Results)
- **What:** Release tranches only when specific outcomes are verified (not just UC submission)
- **Implement:**
  - `POST /v1/grant/schemes/:id/outcome-triggers` — define outcome → tranche mapping
  - `POST /v1/grant/outcomes/verify` — verifier confirms outcome achieved (evidence_ref, geo_tag)
  - On verification: auto-release linked installment (milestone-triggered already exists — extend)
  - Schema: `scheme.outcome_triggers`, `scheme.outcome_verifications`
- **Domain:** `checkOutcomeEligibility(outcomes, triggers)`, `autoReleaseOnVerification(verification)`

### Gap 5: Convergence Mapping (Multi-Scheme per Beneficiary)
- **What:** Track which beneficiary receives benefits from multiple schemes, ensure no conflict/overlap
- **Implement:**
  - `GET /v1/grant/beneficiaries/:id/convergence` — all schemes the beneficiary is enrolled in
  - `GET /v1/grant/convergence/overlap-report` — beneficiaries receiving overlapping benefits
  - `POST /v1/grant/convergence/rules` — define exclusion rules (scheme A excludes scheme B recipients)
  - Schema: `beneficiary.convergence_rules` (scheme_a_id, scheme_b_id, rule_type: 'exclude'|'cap')
- **Domain:** `checkConvergenceViolation(beneficiaryId, newSchemeId, existingEnrollments)`

### Gap 6: Social Audit Integration
- **What:** Enable community-level social audits of grant utilization, findings linked to schemes
- **Implement:**
  - `POST /v1/grant/social-audits` — create social audit (scheme_id, location, auditors, date)
  - `POST /v1/grant/social-audits/:id/findings` — record audit findings (category, severity, evidence)
  - `GET /v1/grant/social-audits/scheme/:schemeId/summary` — audit compliance score per scheme
  - Schema: `utilisation.social_audits`, `utilisation.social_audit_findings`
- **Domain:** `computeAuditComplianceScore(findings)`, `identifyHighRiskLocations(audits)`

### Gap 7: Grant Analytics & Leakage Detection
- **What:** Statistical analysis of disbursement patterns to identify potential leakage/fraud
- **Implement:**
  - `GET /v1/grant/analytics/disbursement-velocity` — disbursement rate by location/implementor
  - `GET /v1/grant/analytics/anomalies` — flagged transactions (unusually fast, clustered amounts, etc.)
  - `GET /v1/grant/analytics/utilisation-rate` — UC submission rate vs disbursement timeline
  - Rules: flag if all disbursements in a block are identical amounts, or if UC submitted same day as disbursement
- **Domain:** `detectAnomalies(disbursements, rules)`, `computeUtilisationRate(disbursed, ucSubmitted)`

### Gap 8: Donor/Funder Reporting Portal
- **What:** External stakeholders (central ministry, donor agencies) view scheme progress without full access
- **Implement:**
  - `GET /v1/grant/portal/schemes/:id/progress` — read-only aggregate (disbursed, UC, outcomes)
  - `GET /v1/grant/portal/schemes/:id/reports` — downloadable progress reports
  - Separate auth role: `grant_funder_portal` with read-only access to aggregated data only
  - Schema: No new tables — aggregated views of existing data
- **Domain:** Access control: only aggregated/anonymized data (no beneficiary PII)

---

## Phase C–F: Same structure as Module 01

Implementation order: Beneficiary Dedup → Multi-Year Funding → Impact KPIs → Convergence → Outcome-Based → Leakage Detection → Social Audit → Funder Portal

**TOTAL: _/10**
