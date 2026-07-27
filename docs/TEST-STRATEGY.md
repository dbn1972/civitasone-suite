# CivitasOne — World-Class Test Strategy

**Date:** 2026-07-27  
**Owner:** Quality Engineering  
**Status:** Executing  

---

## 1. Risk Model & Lane Sequencing

Lanes are ordered by blast-radius × likelihood. For a multi-tenant government ERP:

| Priority | Lane | ID | Exit Criteria Summary |
|----------|------|----|-----------------------|
| P0 | Tenant Isolation | L1 | 0 cross-tenant reads/writes across 100% endpoints |
| P0 | Authz / BOLA / IDOR | L2 | 100% endpoints enforce intended role; 0 BOLA |
| P0 | Data & Schema Integrity | L3 | 0 drift; 0 float money; 0 unbalanced vouchers |
| P0 | Domain Correctness | L10 | 100% match to golden oracles |
| P1 | API Contract & Input | L4 | 100% schema-valid; 0 injection; idempotent |
| P1 | Events / Distributed | L5 | 0 orphan events; DLQ replay 100% |
| P1 | Security | L6 | 0 Critical/High SAST/DAST |
| P1 | UX / A11Y / I18N | L9 | 0 axe serious/critical; 13 persona journeys green |
| P2 | Reliability / Chaos / SRE | L7 | p95<200ms reads; 0 5xx; DR meets RPO/RTO |
| P2 | AI Features | L8 | Judge score ≥ threshold; 0 prompt-injection |
| Meta | Mutation & Gate Validity | L11 | Score ≥70%; 100% planted canaries caught |

---

## 2. Test Infrastructure

See [TEST-INFRA.md](./TEST-INFRA.md) for ephemeral DB harness, determinism rules, and CI wiring.

---

## 3. Golden Oracles (B3)

Reference datasets for domain math live in `tests/quality-program/goldens/`:
- 7th CPC pay matrix cells
- DA/HRA rates by city classification
- Tax slabs (FY24-25) + 87A + surcharge + cess
- Pension/DCRG/gratuity caps
- Double-entry zero-sum invariants

---

## 4. Traceability (B4)

`tests/quality-program/TRACEABILITY.csv` maps every capability to test IDs.

---

## 5. Evidence Pack (B5)

Every gate emits results to `/evidence/<date>/`:
- JUnit XML
- JSON summaries
- Screenshots/traces (Playwright)
- ZAP reports (when DAST runs)

---

## 6. CI Gate Enforcement

**Blocking on PR→main:**
- Pre-commit: fmt/lint/type/secret
- L1: Tenant isolation
- L2: Authz matrix
- L3: Schema drift + money audit
- L4: Contract validation
- L5: Event contract (existing)
- L6: SAST (CodeQL + sql-injection-guard)
- L9: A11Y (existing axe-core)
- L11: Canary verification

**Nightly full:** All lanes including chaos/soak/DAST/mutation.

---

## 7. Stop Rules

Each lane has a hard stop:
- If a P0 lane finds a release-blocker, development halts on that service until fixed.
- If a gate cannot demonstrably fail on a planted defect, the gate is theater → fix first.
- External dependencies (DigiLocker, PFMS) use stubs; if stub unavailable → fail-closed, never fabricate.

---

## 8. Definition of Done (Program)

A change cannot reach production unless it clears every P0/P1 gate with evidence,
and the only remaining human work is acceptance + policy sign-off.
